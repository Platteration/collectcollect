import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { conditionFactor, describeGames, gradeWindowAlert, outlookFor, summarizeGames } from "@/lib/pricing/summary";
import { DEFAULT_SETTINGS, type Game } from "@/lib/types";
import type { ItemInput, PriceQuote } from "@collectcollect/core/domain/spec";
import { gradingVerdict } from "@collectcollect/core/grading";

const settings = { ...engine.settings.defaults, ownerName: "", alertMovePercent: 15, alertWebhookUrl: "", exportPrivateFields: false };

const quote = (prices: Record<string, number>, over: Partial<PriceQuote> = {}): PriceQuote => ({
  source: "pricecharting",
  sourceLabel: "PriceCharting",
  currency: "USD",
  url: null,
  matchedName: "Super Mario 64",
  matchedDetail: "Nintendo 64",
  price: prices.Loose ?? null,
  prices,
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});
const tiers = { Loose: 35, CIB: 120, New: 2500 };

function game(over: Partial<ItemInput<Game>> = {}) {
  return engine.repo.createItem({ title: "Super Mario 64", platform: "n64", region: "ntsc_u", completeness: "loose", mediaCondition: "very_good", ...over });
}

const summarize = (item: ReturnType<typeof game>, quotes: PriceQuote[], errors: Array<{ source: string; message: string }> = []) =>
  summarizeGames({ item, quotes, errors, settings, fetchedAt: "2026-01-02T00:00:00.000Z" });

describe("what a copy is worth", () => {
  it("reads the price of its own completeness", () => {
    expect(summarize(game(), [quote(tiers)]).yourCopyValue).toBe(35);
    expect(summarize(game({ completeness: "cib", boxCondition: "very_good", manualCondition: "very_good", mediaCondition: "very_good" }), [quote(tiers)]).yourCopyValue).toBe(120);
    const sealed = summarize(game({ completeness: "sealed", boxCondition: "very_good" }), [quote(tiers)]);
    expect(sealed.yourCopyValue).toBe(2500);
    expect(sealed.yourCopyBasis).toMatch(/New price for a sealed copy/);
    expect(sealed.tiers).toEqual(tiers);
  });

  it("scales by condition: the cart when loose, the box when sealed, the worst part when complete", () => {
    expect(conditionFactor({ completeness: "loose", mediaCondition: "good", boxCondition: null, manualCondition: null }, DEFAULT_SETTINGS)).toEqual({ factor: 0.9, label: "Good cartridge" });
    expect(conditionFactor({ completeness: "sealed", mediaCondition: null, boxCondition: "mint", manualCondition: null }, DEFAULT_SETTINGS).factor).toBe(1.15);
    expect(conditionFactor({ completeness: "cib", mediaCondition: "mint", boxCondition: "very_good", manualCondition: "fair" }, DEFAULT_SETTINGS)).toEqual({ factor: 0.7, label: "Fair manual" });
    expect(conditionFactor({ completeness: "cib", mediaCondition: null, boxCondition: null, manualCondition: null }, DEFAULT_SETTINGS)).toEqual({ factor: 1, label: "condition not recorded" });
    const worn = summarize(game({ mediaCondition: "poor" }), [quote(tiers)]);
    expect(worn.yourCopyValue).toBe(17.5);
    expect(worn.yourCopyBasis).toMatch(/× 0.5 for a Poor cartridge/);
  });

  it("values a graded copy at the graded price, or estimates one from the sealed price", () => {
    const slab = game({ completeness: "graded", gradingCompany: "wata", grade: "9.4 A+", boxCondition: "near_mint", mediaCondition: null });
    const real = summarize(slab, [quote({ ...tiers, Graded: 9000 })]);
    expect(real.yourCopyValue).toBe(9000);
    expect(real.graded).toEqual({ Graded: 9000 });
    expect(real.estimatedGraded).toEqual({});
    const estimated = summarize(slab, [quote(tiers)]);
    expect(estimated.yourCopyValue).toBe(5000);
    expect(estimated.yourCopyBasis).toMatch(/Estimated: New price × 2/);
    expect(estimated.ungraded).toBe(2500);
    // A slab with a cartridge grade was a complete copy, not a sealed one.
    const cibSlab = game({ completeness: "graded", gradingCompany: "wata", grade: "9.0 A", boxCondition: "very_good", manualCondition: "very_good", mediaCondition: "very_good" });
    expect(summarize(cibSlab, [quote(tiers)])).toMatchObject({ yourCopyValue: 168, ungraded: 120 });
  });

  it("lets a price typed by hand win, per key or outright", () => {
    const byKey = summarize({ ...game(), manualPrices: { Loose: 50 } }, [quote(tiers)]);
    expect(byKey.yourCopyValue).toBe(50);
    expect(byKey.tiers.Loose).toBe(50);
    expect(byKey.tiers.CIB).toBe(120);
    expect(byKey.ungradedSource).toBe("Your own price");
    const outright = summarize({ ...game(), manualValue: 42 }, [quote(tiers)]);
    expect(outright).toMatchObject({ yourCopyValue: 42, yourCopyBasis: "Your own price" });
    expect(outright.quotes[0].source).toBe("manual");
  });

  it("has no value, and says why, when nothing answered", () => {
    expect(summarize(game(), [])).toMatchObject({ yourCopyValue: null, yourCopyBasis: "No source has a price for this yet", tiers: {} });
    expect(summarize(game(), [], [{ source: "pricecharting", message: "down" }]).yourCopyBasis).toMatch(/every source failed/);
  });

  it("describes the tiers in one line for the Markdown copy", () => {
    expect(describeGames(summarize(game(), [quote({ ...tiers, Graded: 9000 })]))).toBe("Loose $35.00 · CIB $120.00 · New $2,500.00 · Graded $9,000.00 (PriceCharting)");
    expect(describeGames(summarize(game(), []))).toBe("");
  });
});

describe("grade it, or wait", () => {
  const sealed = () => game({ completeness: "sealed", boxCondition: "very_good" });
  const snap = (id: number, at: string, prices: Record<string, number>, item = sealed()) => ({ id, fetchedAt: at, summary: summarize(item, [quote(prices, { fetchedAt: at })]) });

  it("measures the upside of grading a sealed copy after the fee", () => {
    const item = sealed();
    const [point] = outlookFor(item, [snap(1, "2026-01-01T00:00:00.000Z", { New: 2500, Graded: 9000 }, item)], settings);
    expect(point).toMatchObject({ raw: 2500, max: 9000, maxLabel: "Graded", fee: 100, upside: 6400, fromRealData: true });
  });

  it("has nothing to say about a loose or already graded copy", () => {
    expect(outlookFor(game(), [snap(1, "2026-01-01T00:00:00.000Z", { Loose: 35, Graded: 9000 })], settings)).toEqual([]);
    const slab = game({ completeness: "graded", gradingCompany: "wata", grade: "9.4 A+" });
    expect(outlookFor(slab, [snap(1, "2026-01-01T00:00:00.000Z", { New: 2500, Graded: 9000 }, slab)], settings)).toEqual([]);
  });

  it("says prime while the gap is at its widest and wait once it narrows", () => {
    const item = sealed();
    const widening = outlookFor(item, [snap(1, "2026-01-01T00:00:00.000Z", { New: 2500, Graded: 6000 }, item), snap(2, "2026-02-01T00:00:00.000Z", { New: 2500, Graded: 7000 }, item), snap(3, "2026-03-01T00:00:00.000Z", { New: 2500, Graded: 9000 }, item)], settings);
    expect(gradingVerdict(widening).kind).toBe("prime");
    const narrowed = outlookFor(item, [snap(1, "2026-01-01T00:00:00.000Z", { New: 2500, Graded: 9000 }, item), snap(2, "2026-02-01T00:00:00.000Z", { New: 2500, Graded: 8000 }, item), snap(3, "2026-03-01T00:00:00.000Z", { New: 2500, Graded: 5000 }, item)], settings);
    expect(gradingVerdict(narrowed).kind).toBe("wait");
    const pointless = outlookFor(item, [snap(1, "2026-01-01T00:00:00.000Z", { New: 2500, Graded: 2550 }, item)], settings);
    expect(gradingVerdict(pointless).kind).toBe("skip");
  });

  it("raises one alert when a copy first becomes worth grading", () => {
    const item = sealed();
    const history = [snap(1, "2026-01-01T00:00:00.000Z", { New: 2500, Graded: 6000 }, item), snap(2, "2026-02-01T00:00:00.000Z", { New: 2500, Graded: 7000 }, item)];
    const next = summarize(item, [quote({ New: 2500, Graded: 9000 }, { fetchedAt: "2026-03-01T00:00:00.000Z" })]);
    const alerts = gradeWindowAlert({ item, history, next: { ...next, fetchedAt: "2026-03-01T00:00:00.000Z" }, settings });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "grade_window", itemId: item.id });
    expect(alerts[0].body).toMatch(/\$6,400\.00 of upside/);
    // Already ready last time: nothing new to say.
    const again = gradeWindowAlert({ item, history: [...history, { id: 3, fetchedAt: "2026-03-01T00:00:00.000Z", summary: next }], next: { ...next, fetchedAt: "2026-04-01T00:00:00.000Z" }, settings });
    expect(again).toEqual([]);
    expect(gradeWindowAlert({ item: game(), history: [], next: summarize(game(), [quote(tiers)]), settings })).toEqual([]);
  });
});
