import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { certVerifier, verifyCert } from "@/lib/cert";

const slab = (over: Record<string, unknown> = {}) =>
  engine.repo.createItem({ title: "The Amazing Spider-Man", issueNumber: "300", slabbed: true, gradingCompany: "cgc", grade: "9.4", certNumber: "2036123-004", ...over });

describe("checking a certificate", () => {
  it("only applies to a slab", async () => {
    const raw = engine.repo.createItem({ title: "Saga", issueNumber: "1", grade: "9.0" });
    expect(certVerifier.applies!(raw)).toBe(false);
    expect(await verifyCert(raw)).toMatchObject({ status: "unknown", detail: expect.stringMatching(/raw comic/) });
  });

  it("has nothing to check without a number", async () => {
    expect(await verifyCert(slab({ certNumber: null }))).toMatchObject({ status: "unknown", detail: expect.stringMatching(/No cert number/) });
  });

  it("calls out a number that cannot be the company's", async () => {
    expect(await verifyCert(slab({ certNumber: "ABC-1" }))).toMatchObject({ status: "mismatch", detail: expect.stringMatching(/does not look like a CGC number/) });
    expect(await verifyCert(slab({ gradingCompany: "cbcs", certNumber: "2036123-004" }))).toMatchObject({ status: "mismatch" });
    expect(await verifyCert(slab({ gradingCompany: "pgx", certNumber: "12" }))).toMatchObject({ status: "mismatch" });
  });

  it("answers unknown, with where to look, for a well-formed number until the live lookup exists", async () => {
    const cgc = await verifyCert(slab());
    expect(cgc.status).toBe("unknown");
    expect(cgc.detail).toMatch(/shape of a CGC number/);
    expect(cgc.detail).toContain("cgccomics.com/certlookup");
    const cbcs = await verifyCert(slab({ gradingCompany: "cbcs", certNumber: "19-2C4E7A1B-001" }));
    expect(cbcs.status).toBe("unknown");
    expect(cbcs.detail).toContain("cert=19-2C4E7A1B-001");
    expect((await verifyCert(slab({ gradingCompany: "pgx", certNumber: "12345678" }))).status).toBe("unknown");
  });
});
