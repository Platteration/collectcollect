import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { describeComics, gradeWindowAlert, outlookFor, rawFactor, summarizeComics } from "@/lib/pricing/summary";
import { DEFAULT_SETTINGS, type Comic } from "@/lib/types";
import type { ItemInput, PriceQuote } from "@collectcollect/core/domain/spec";
import { gradingVerdict } from "@collectcollect/core/grading";

const settings = { ...engine.settings.defaults, ownerName: "", alertMovePercent: 15, alertWebhookUrl: "", exportPrivateFields: false };

const quote = (prices: Record<string, number>, raw: number | null = 250, over: Partial<PriceQuote> = {}): PriceQuote => ({
  source: "pricecharting",
  sourceLabel: "PriceCharting",
  currency: "USD",
  url: null,
  matchedName: "Amazing Spider-Man #300",
  matchedDetail: "Marvel Comics",
  price: raw,
  prices,
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});
const grades = { "Grade 8.0": 600, "Grade 9.0": 900, "Grade 9.2": 1100, "Grade 9.4": 1400, "Grade 9.8": 4000 };

function comic(over: Partial<ItemInput<Comic>> = {}) {
  return engine.repo.createItem({ title: "The Amazing Spider-Man", issueNumber: "300", publisher: "Marvel", ...over });
}
const summarize = (item: ReturnType<typeof comic>, quotes: PriceQuote[]) => summarizeComics({ item, quotes, errors: [], settings, fetchedAt: "2026-01-02T00:00:00.000Z" });

describe("what a copy is worth", () => {
  it("scales the raw price down by the estimated grade's bucket", () => {
    expect(rawFactor("9.2", DEFAULT_SETTINGS)).toEqual({ factor: 1, bucket: "9" });
    expect(rawFactor("VF/NM 9.0", DEFAULT_SETTINGS)).toEqual({ factor: 1, bucket: "9" });
    expect(rawFactor("8.5", DEFAULT_SETTINGS)).toEqual({ factor: 0.8, bucket: "8" });
    expect(rawFactor("4.0", DEFAULT_SETTINGS)).toEqual({ factor: 0.35, bucket: "4" });
    expect(rawFactor(null, DEFAULT_SETTINGS)).toEqual({ factor: 1, bucket: null });
    expect(summarize(comic({ grade: "9.2" }), [quote(grades)]).yourCopyValue).toBe(250);
    const worn = summarize(comic({ grade: "4.0" }), [quote(grades)]);
    expect(worn.yourCopyValue).toBe(87.5);
    expect(worn.yourCopyBasis).toMatch(/× 0.35 for a raw copy around 4.0/);
  });

  it("reads a slab's grade from the source, or estimates it from the raw price", () => {
    const slab = comic({ slabbed: true, gradingCompany: "cgc", grade: "9.4", certNumber: "2036123-004" });
    const real = summarize(slab, [quote(grades)]);
    expect(real.yourCopyValue).toBe(1400);
    expect(real.yourCopyBasis).toMatch(/Grade 9.4 price from PriceCharting/);
    const odd = comic({ slabbed: true, gradingCompany: "cbcs", grade: "9.6", certNumber: "19-2C4E7A1B-001" });
    const estimated = summarize(odd, [quote(grades)]);
    expect(estimated.yourCopyValue).toBe(500);
    expect(estimated.yourCopyBasis).toMatch(/Estimated: ungraded price × 2/);
    expect(estimated.estimatedGraded["Grade 9.6"]).toBe(500);
  });

  it("adds the premium for a witnessed signature", () => {
    const ss = comic({ slabbed: true, gradingCompany: "cgc", grade: "9.8", certNumber: "3742009-012", signatureSeries: true });
    const summary = summarize(ss, [quote(grades)]);
    expect(summary.yourCopyValue).toBe(5000);
    expect(summary.yourCopyBasis).toMatch(/× 1.25 for the witnessed signature/);
  });

  it("lets a price typed by hand win, per grade or outright", () => {
    const slab = comic({ slabbed: true, gradingCompany: "cgc", grade: "9.8", certNumber: "3742009-012" });
    expect(summarize({ ...slab, manualPrices: { "Grade 9.8": 4500 } }, [quote(grades)]).yourCopyValue).toBe(4500);
    expect(summarize({ ...slab, manualValue: 4200, signatureSeries: true }, [quote(grades)])).toMatchObject({ yourCopyValue: 4200, yourCopyBasis: "Your own price" });
  });

  it("describes the prices in one line for the Markdown copy", () => {
    expect(describeComics(summarize(comic({ grade: "9.2" }), [quote({ "Grade 9.8": 4000, "Grade 8.0": 600 })]))).toBe("Raw $250.00 · Grade 9.8 $4,000.00 · Grade 8.0 $600.00 (PriceCharting)");
    expect(describeComics(summarize(comic(), []))).toBe("");
  });
});

describe("grade it, or wait", () => {
  const snap = (id: number, at: string, prices: Record<string, number>, item: ReturnType<typeof comic>, raw = 250) => ({ id, fetchedAt: at, summary: summarize(item, [quote(prices, raw, { fetchedAt: at })]) });

  it("measures the upside of slabbing a raw copy at the grade the owner expects", () => {
    const item = comic({ grade: "9.4" });
    const [point] = outlookFor(item, [snap(1, "2026-01-01T00:00:00.000Z", grades, item)], settings);
    expect(point).toMatchObject({ raw: 250, max: 4000, maxLabel: "Grade 9.8", min: 600, minLabel: "Grade 8.0", fee: 60, upside: 3690, likely: 1400, likelyLabel: "Grade 9.4", fromRealData: true });
  });

  it("has nothing to say about a slab", () => {
    const slab = comic({ slabbed: true, gradingCompany: "cgc", grade: "9.4", certNumber: "2036123-004" });
    expect(outlookFor(slab, [snap(1, "2026-01-01T00:00:00.000Z", grades, slab)], settings)).toEqual([]);
  });

  it("raises one alert when a raw copy first becomes worth grading", () => {
    const item = comic({ grade: "9.4" });
    const history = [snap(1, "2026-01-01T00:00:00.000Z", { ...grades, "Grade 9.8": 2000 }, item), snap(2, "2026-02-01T00:00:00.000Z", { ...grades, "Grade 9.8": 3000 }, item)];
    const next = { ...summarize(item, [quote(grades)]), fetchedAt: "2026-03-01T00:00:00.000Z" };
    const alerts = gradeWindowAlert({ item, history, next, settings });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("Good time to grade: The Amazing Spider-Man #300");
    expect(gradingVerdict([...outlookFor(item, history, settings), ...outlookFor(item, [{ id: 3, fetchedAt: next.fetchedAt, summary: next }], settings)]).kind).toBe("prime");
    expect(gradeWindowAlert({ item, history: [...history, { id: 3, fetchedAt: next.fetchedAt, summary: next }], next: { ...next, fetchedAt: "2026-04-01T00:00:00.000Z" }, settings })).toEqual([]);
  });
});
