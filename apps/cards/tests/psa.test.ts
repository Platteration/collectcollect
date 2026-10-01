import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PSA_API, PsaError, createPsaBudget, imagesFromPsa, lookupCert, reportFromPsaCert, setPsaBudget } from "@/lib/grading/psa";
import { applyReport, manualReport } from "@/lib/grading/report";
import type { CardRecord } from "@/lib/types";
import { fakeFetch } from "./helpers";
import cert from "./fixtures/psa-cert.json";
import images from "./fixtures/psa-images.json";

const answer = (routes: Array<[string | RegExp, unknown, number?]>) => fakeFetch(routes);
const calls = (fetchImpl: typeof fetch) => (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;

describe("PSA's cert lookup", () => {
  beforeEach(() => {
    vi.stubEnv("PSA_API_TOKEN", "t");
    setPsaBudget(createPsaBudget());
  });
  afterEach(() => vi.unstubAllEnvs());

  it("fills a report from PSA's cert record and its images, asking with the token", async () => {
    const fetchImpl = answer([
      ["GetByCertNumber/12345678", cert],
      ["GetImagesByCertNumber/12345678", images],
    ]);
    const found = await lookupCert("12345678", fetchImpl);
    expect(found.found).toBe(true);
    if (!found.found) return;
    expect(found.imagesSkipped).toBe(false);
    expect(found.report).toMatchObject({
      company: "PSA",
      cert: "12345678",
      source: "psa",
      grade: "10",
      gradeText: "GEM MT 10",
      label: "Standard",
      population: { atGrade: 123, total: null, higher: 0 },
      images: { front: "https://images.psacard.com/cert/12345678/front.jpg", back: "https://images.psacard.com/cert/12345678/back.jpg" },
      url: "https://www.psacard.com/cert/12345678/psa",
      identity: { subject: "CHARIZARD-HOLO", brand: "POKEMON GAME", year: "1999", cardNumber: "4", variety: "1ST EDITION", category: "TCG Cards" },
      subgrades: null,
      tag: null,
    });
    expect(calls(fetchImpl)).toHaveLength(2);
    for (const [url, init] of calls(fetchImpl)) {
      expect(url.startsWith(PSA_API)).toBe(true);
      expect((init.headers as Record<string, string>).authorization).toBe("bearer t");
    }
  });

  it("says the cert is unknown on a 204 or an empty record, refuses on 401, explains a 403, waits what PSA asks on a 429 and explains a 500", async () => {
    const status = (code: number, headers: Record<string, string> = {}) =>
      vi.fn(async () => new Response(code === 204 ? null : "{}", { status: code, headers })) as unknown as typeof fetch;
    expect(await lookupCert("12345678", status(204))).toEqual({ found: false });
    expect(await lookupCert("12345678", answer([["GetByCertNumber", { PSACert: null, DNACert: null }]]))).toEqual({ found: false });
    await expect(lookupCert("12345678", status(401))).rejects.toMatchObject({ status: 502, message: /refused the token/ });
    await expect(lookupCert("12345678", status(403))).rejects.toMatchObject({ status: 502, message: /not approved this account/ });
    await expect(lookupCert("12345678", status(500))).rejects.toMatchObject({ status: 502, message: /HTTP 500/ });
    await expect(lookupCert("12345678", status(418))).rejects.toMatchObject({ status: 502, message: /HTTP 418/ });
    const limited = await lookupCert("12345678", status(429, { "retry-after": "120" })).catch((e: PsaError) => e);
    expect(limited).toMatchObject({ status: 429, retryAfterMs: 120_000, message: /rate limiting.*2 minutes/ });
    // The pause PSA asked for holds the next lookup back without a request.
    const quiet = answer([["GetByCertNumber", cert]]);
    await expect(lookupCert("12345678", quiet)).rejects.toMatchObject({ status: 429 });
    expect(calls(quiet)).toHaveLength(0);
  });

  it("makes no request without a token or for a cert of the wrong shape, and refuses at the daily budget without waiting", async () => {
    const fetchImpl = answer([
      ["GetByCertNumber", cert],
      ["GetImagesByCertNumber", images],
    ]);
    vi.stubEnv("PSA_API_TOKEN", "");
    await expect(lookupCert("12345678", fetchImpl)).rejects.toMatchObject({ status: 503, message: /PSA_API_TOKEN/ });
    vi.stubEnv("PSA_API_TOKEN", "t");
    await expect(lookupCert("abc", fetchImpl)).rejects.toMatchObject({ status: 400, message: /8 to 10 digits/ });
    expect(calls(fetchImpl)).toHaveLength(0);
    // Three lookups' worth of budget: the record and its images count one each.
    setPsaBudget(createPsaBudget(3, 1000));
    const first = await lookupCert("12345678", fetchImpl);
    expect(first).toMatchObject({ found: true, imagesSkipped: false });
    // One left: the record is fetched, the images are skipped rather than waited for.
    const second = await lookupCert("12345678", fetchImpl);
    expect(second).toMatchObject({ found: true, imagesSkipped: true });
    const started = Date.now();
    await expect(lookupCert("12345678", fetchImpl)).rejects.toMatchObject({ status: 429, message: /used its PSA lookups for today/ });
    expect(Date.now() - started).toBeLessThan(500);
    expect(calls(fetchImpl)).toHaveLength(3);
  });

  it("reads images from either shape PSA might send, https only, and skips them when that call fails", async () => {
    expect(imagesFromPsa(images)).toEqual({ front: "https://images.psacard.com/cert/12345678/front.jpg", back: "https://images.psacard.com/cert/12345678/back.jpg" });
    expect(imagesFromPsa({ PSACertImages: images })).toEqual({ front: "https://images.psacard.com/cert/12345678/front.jpg", back: "https://images.psacard.com/cert/12345678/back.jpg" });
    expect(imagesFromPsa({ FrontImageURL: "https://a/f.jpg", BackImageURL: "https://a/b.jpg" })).toEqual({ front: "https://a/f.jpg", back: "https://a/b.jpg" });
    expect(imagesFromPsa([{ ImageURL: "https://a/1.jpg" }, { ImageURL: "https://a/2.jpg" }])).toEqual({ front: "https://a/1.jpg", back: "https://a/2.jpg" });
    expect(imagesFromPsa([{ IsFrontImage: true, ImageURL: "http://a/f.jpg" }])).toBeNull();
    expect(imagesFromPsa(null)).toBeNull();
    expect(imagesFromPsa({})).toBeNull();
    const fetchImpl = answer([
      ["GetByCertNumber", cert],
      ["GetImagesByCertNumber", { Message: "boom" }, 500],
    ]);
    expect(await lookupCert("12345678", fetchImpl)).toMatchObject({ found: true, imagesSkipped: true, report: { images: null, grade: "10" } });
  });

  it("reads the grade out of PSA's text and leaves what PSA did not say null", () => {
    const at = "2026-10-01T00:00:00.000Z";
    expect(reportFromPsaCert("1", { CardGrade: "NM-MT 8.5", LabelType: "", Subject: null }, null, at)).toMatchObject({ grade: "8.5", gradeText: "NM-MT 8.5", label: null, population: null, identity: null, images: null });
    expect(reportFromPsaCert("1", { CardGrade: "AUTHENTIC" }, null, at)).toMatchObject({ grade: "AUTHENTIC", gradeText: "AUTHENTIC" });
    expect(reportFromPsaCert("1", { CardGrade: "10", TotalPopulation: "5" }, null, at)).toMatchObject({ grade: "10", population: { atGrade: 5, total: null, higher: null } });
    expect(reportFromPsaCert("12345678", {}, null, at)).toMatchObject({ grade: null, gradeText: null, checkedAt: at, url: "https://www.psacard.com/cert/12345678/psa" });
  });
});

describe("what a report changes on the card", () => {
  const card = (over: Partial<CardRecord> = {}): CardRecord =>
    ({ id: 1, game: "pokemon", name: "Charizard", setName: null, cardNumber: null, year: null, variant: null, manufacturer: null, grade: null, gradingCompany: null, certNumber: null, ...over }) as CardRecord;
  const report = reportFromPsaCert("12345678", cert.PSACert, null, "2026-10-01T00:00:00.000Z");

  it("sets the company, grade, cert and report, and fills identity only when asked and only where the card is blank", () => {
    expect(applyReport(card(), report)).toEqual({ gradingCompany: "PSA", grade: "10", certNumber: "12345678", gradingReport: report, gradingStatus: "undecided" });
    expect(applyReport(card({ setName: "Base Set", cardNumber: "4/102" }), report, { identity: true })).toMatchObject({ year: 1999, variant: "1ST EDITION" });
    expect(applyReport(card({ setName: "Base Set", cardNumber: "4/102" }), report, { identity: true })).not.toHaveProperty("setName");
    expect(applyReport(card(), report, { identity: true })).toMatchObject({ setName: "1999 POKEMON GAME 1ST EDITION", cardNumber: "4", year: 1999 });
    expect(applyReport(card(), report, { identity: true })).not.toHaveProperty("manufacturer");
    expect(applyReport(card({ game: "sports" }), report, { identity: true })).toMatchObject({ manufacturer: "POKEMON GAME" });
    // A record with no grade keeps the card's.
    expect(applyReport(card({ grade: "9" }), { ...report, grade: null })).toMatchObject({ grade: "9" });
    expect(applyReport(card(), report)).not.toHaveProperty("imagePath");
  });

  it("writes a bare report for a slab recorded by hand, linking the company's page, and none for a company without one", () => {
    expect(manualReport("TAG", "A1234567", "10", "2026-10-01T00:00:00.000Z")).toMatchObject({ company: "TAG", cert: "A1234567", grade: "10", source: "manual", url: "https://my.taggrading.com/card/A1234567", subgrades: null, tag: null });
    expect(manualReport("Other", "1", "10")).toBeNull();
  });
});
