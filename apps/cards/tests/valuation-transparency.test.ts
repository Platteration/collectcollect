import { describe, expect, it } from "vitest";
import { gradingOutlook, gradingVerdict, outlookSeries } from "@/lib/analytics";
import { DEFAULT_SETTINGS, type PriceQuote, type PriceSummary } from "@/lib/types";
import { priceCoverage } from "@collectcollect/core/price-coverage";
const summary: PriceSummary = { currency: "USD", fetchedAt: "2026-09-15T12:00:00.000Z", ungraded: 100, ungradedSource: "Fixture", graded: { "PSA 10": 500 }, gradedSource: "Fixture", estimatedGraded: { "PSA 8": 110 }, yourCopyValue: 100, yourCopyBasis: "Fixture", quotes: [], errors: [] };
describe("valuation transparency", () => {
  it("labels each bound independently when real and estimated grades are mixed", () => {
    expect(gradingOutlook(summary, DEFAULT_SETTINGS)).toMatchObject({ fromRealData: false, provenance: { min: "estimated", max: "observed", maxSource: "Fixture" } });
  });
  it("does not treat three refreshes on the same day as three days of history", () => {
    const snapshots = [10, 11, 12].map((hour, id) => ({ id, cardId: 1, fetchedAt: `2026-09-15T${hour}:00:00.000Z`, summary }));
    expect(gradingVerdict(outlookSeries(snapshots, DEFAULT_SETTINGS)).kind).toBe("insufficient");
  });
  it("attributes each measured outcome to the winning USD quote and its timestamp", () => {
    const quote = (source: PriceQuote["source"], currency: PriceQuote["currency"], fetchedAt: string): PriceQuote => ({
      source, sourceLabel: source, currency, fetchedAt, url: null, matchedName: "Fixture", matchedDetail: null,
      ungraded: null, ungradedVariants: {}, graded: { "PSA 8": 110, "PSA 10": 500 },
    });
    const prices = { ...summary, graded: { "PSA 8": 110, "PSA 10": 500 }, quotes: [
      quote("manual", "EUR", "2026-09-15T11:00:00Z"),
      quote("pricecharting", "USD", "2026-09-15T10:00:00Z"),
      quote("manual", "USD", "2026-09-14T09:00:00Z"),
    ] };
    expect(gradingOutlook(prices, DEFAULT_SETTINGS, "8")).toMatchObject({ fromRealData: true, provenance: {
      minSource: "manual", maxSource: "manual", likelySource: "manual",
      minAt: "2026-09-14T09:00:00Z", maxAt: "2026-09-14T09:00:00Z", likelyAt: "2026-09-14T09:00:00Z",
    } });
  });
  it("describes multiplier history as recorded comparisons without claiming observed sales", () => {
    const estimated = { ...summary, graded: {}, estimatedGraded: { "PSA 8": 110, "PSA 10": 500 } };
    const snapshots = [13, 14, 15].map((day, id) => ({ id, cardId: 1, fetchedAt: `2026-09-${day}T12:00:00Z`, summary: estimated }));
    const verdict = gradingVerdict(outlookSeries(snapshots, DEFAULT_SETTINGS));
    expect(verdict.kind).toBe("prime");
    expect(verdict.headline).toContain("recorded");
    expect(verdict.headline + verdict.detail).not.toContain("observed");
  });
  it("counts all stale and unpriced holdings even when one quote is fresh", () => {
    expect(priceCoverage([{ priced: true, fetchedAt: "2026-09-15T10:00:00Z" }, { priced: true, fetchedAt: "2026-09-10T00:00:00Z" }, { priced: false }], 24, Date.parse("2026-09-15T12:00:00Z"))).toEqual({ fresh: 1, stale: 1, unpriced: 1 });
  });
});
