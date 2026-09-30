import { beforeEach, describe, expect, it } from "vitest";
import { getDb, openDatabase, setDb } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { PUT } from "@/app/api/settings/route";
import { DEFAULT_SETTINGS, type PriceQuote } from "@/lib/types";
import { addSnapshot, createCard, latestSnapshot } from "@/lib/cards";
import { summarize } from "@/lib/pricing";

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

describe("saving settings", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("changes only what it was given", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, gradingFee: 30, ownerName: "Ada" });
    const res = await put({ gradingFee: 42 });
    expect(res.status).toBe(200);
    const settings = getSettings();
    expect(settings.gradingFee).toBe(42);
    expect(settings.ownerName).toBe("Ada");
  });

  it("refuses a value that is not a number, and changes nothing", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, gradingFee: 30 });
    // A field the browser could not parse arrives as null: JSON has no NaN.
    const res = await put({ gradingFee: null });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/grading fee/);
    expect(getSettings().gradingFee).toBe(30);
  });

  it("does not quietly send a condition multiplier back to the default", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, conditionMultipliers: { ...DEFAULT_SETTINGS.conditionMultipliers, LP: 0.9 } });
    const res = await put({ conditionMultipliers: { NM: 1, LP: null, MP: 0.7, HP: 0.5, DMG: 0.3 } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/LP/);
    // The user's own 0.9 is still there, rather than the 0.85 default.
    expect(getSettings().conditionMultipliers.LP).toBe(0.9);
  });

  it("leaves conditions it was not told about alone", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, conditionMultipliers: { ...DEFAULT_SETTINGS.conditionMultipliers, HP: 0.42 } });
    const res = await put({ conditionMultipliers: { NM: 1.1 } });
    expect(res.status).toBe(200);
    expect(getSettings().conditionMultipliers).toMatchObject({ NM: 1.1, HP: 0.42 });
  });

  it("refuses a webhook that is not a URL rather than quietly switching alerts off", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, alertWebhookUrl: "https://hooks.example/abc" });
    for (const bad of ["not a url", "ftp://hooks.example/x", "javascript:alert(1)", 42, null]) {
      const res = await put({ alertWebhookUrl: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/webhook/i);
      expect(getSettings().alertWebhookUrl).toBe("https://hooks.example/abc");
    }
    // Blank is how it is switched off on purpose.
    expect((await put({ alertWebhookUrl: "  " })).status).toBe(200);
    expect(getSettings().alertWebhookUrl).toBe("");
    expect((await put({ alertWebhookUrl: " http://hooks.example/x " })).status).toBe(200);
    expect(getSettings().alertWebhookUrl).toBe("http://hooks.example/x");
  });

  it("refuses an owner name that is not text", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, ownerName: "Ada" });
    const res = await put({ ownerName: { first: "A" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/owner name/);
    expect(getSettings().ownerName).toBe("Ada");
  });

  it("lets a grade multiplier be removed", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, gradeMultipliers: { "PSA 10": 3, "PSA 9": 1.4 } });
    const res = await put({ gradeMultipliers: { "PSA 10": 3 } });
    expect(res.status).toBe(200);
    expect(getSettings().gradeMultipliers).toEqual({ "PSA 10": 3 });
  });
});

describe("what a saved setting does to the values already on record", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("works every card's value out again with the new multipliers, and says how many moved", async () => {
    const quote: PriceQuote = { source: "pokemontcg", sourceLabel: "TCGplayer", currency: "USD", url: null, matchedName: "x", matchedDetail: null, ungraded: 100, ungradedVariants: {}, graded: {}, fetchedAt: "2026-03-01T00:00:00.000Z" };
    const slab = createCard({ game: "pokemon", name: "Charizard", gradingCompany: "PSA", grade: "10" });
    addSnapshot(slab.id, summarize([quote], [], DEFAULT_SETTINGS, { condition: "NM", gradingCompany: "PSA", grade: "10" }));
    const unpriced = createCard({ game: "pokemon", name: "Nobody asked" });
    expect(latestSnapshot(slab.id)?.summary.yourCopyValue).toBe(100 * DEFAULT_SETTINGS.gradeMultipliers["PSA 10"]!);
    const res = await put({ gradeMultipliers: { ...DEFAULT_SETTINGS.gradeMultipliers, "PSA 10": 5 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { recomputed: number }).recomputed).toBe(1);
    expect(latestSnapshot(slab.id)?.summary.yourCopyValue).toBe(500);
    expect(latestSnapshot(slab.id)?.summary.estimatedGraded["PSA 10"]).toBe(500);
    expect(latestSnapshot(unpriced.id)).toBeNull();
  });
});

describe("reading settings back", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("applies the same rules as saving, so a stored negative fee comes back as the default", () => {
    // A copy written by hand, or by a version before the rule existed.
    getDb()
      .prepare("INSERT INTO settings (key, value) VALUES ('settings', ?)")
      .run(JSON.stringify({ gradingFee: -20, gradeMultipliers: { "PSA 10": "ten", "PSA 9": 4 }, alertWebhookUrl: "ftp://nope" }));
    const read = getSettings();
    expect(read.gradingFee).toBe(DEFAULT_SETTINGS.gradingFee);
    expect(read.gradeMultipliers).toEqual({ "PSA 9": 4 });
    expect(read.alertWebhookUrl).toBe("");
  });
});
