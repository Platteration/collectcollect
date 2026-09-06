import { describe, expect, it } from "vitest";
import { change, gradingOutlook, gradingVerdict, outlookSeries, portfolioSeries, sliceRange } from "@/lib/analytics";
import { DEFAULT_SETTINGS, type CardRecord, type PriceSnapshot, type PriceSummary } from "@/lib/types";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

const summary = (over: Partial<PriceSummary>): PriceSummary => ({
  currency: "USD",
  fetchedAt: day(0),
  ungraded: null,
  ungradedSource: null,
  graded: {},
  gradedSource: null,
  estimatedGraded: {},
  yourCopyValue: null,
  yourCopyBasis: "",
  quotes: [],
  errors: [],
  ...over,
});

const snap = (id: number, cardId: number, d: number, over: Partial<PriceSummary>): PriceSnapshot => ({
  id,
  cardId,
  fetchedAt: day(d),
  summary: summary({ fetchedAt: day(d), ...over }),
});

const card = (id: number, quantity = 1): CardRecord =>
  ({ id, quantity, game: "pokemon", name: `c${id}`, condition: "NM", grade: null, gradingCompany: null } as unknown as CardRecord);

describe("portfolioSeries", () => {
  it("steps the total as each card's latest snapshot changes, weighted by quantity", () => {
    const cards = [card(1), card(2, 3)];
    const snaps = [
      snap(1, 1, 0, { yourCopyValue: 100, ungraded: 100 }),
      snap(2, 2, 1, { yourCopyValue: 10, ungraded: 8 }),
      snap(3, 1, 2, { yourCopyValue: 120, ungraded: 120 }),
      snap(4, 99, 3, { yourCopyValue: 999 }), // deleted card: ignored
    ];
    const pts = portfolioSeries(cards, snaps);
    expect(pts.map((p) => p.value)).toEqual([100, 130, 150]);
    expect(pts.map((p) => p.ungraded)).toEqual([100, 124, 144]);
    expect(pts[2].priced).toBe(2);
  });
  it("collapses snapshots taken at the same instant", () => {
    const pts = portfolioSeries([card(1), card(2)], [snap(1, 1, 0, { yourCopyValue: 5 }), snap(2, 2, 0, { yourCopyValue: 7 })]);
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBe(12);
  });
});

describe("sliceRange and change", () => {
  const pts = [0, 10, 20, 40].map((d) => ({ t: day(d), value: d }));
  const now = new Date(day(40)).getTime();
  it("keeps one point before the window so the line has a start", () => {
    expect(sliceRange(pts, "1M", now).map((p) => p.value)).toEqual([0, 10, 20, 40]);
    expect(sliceRange(pts, "1W", now).map((p) => p.value)).toEqual([20, 40]);
    expect(sliceRange(pts, "ALL", now)).toHaveLength(4);
  });
  it("computes the delta from the first visible point", () => {
    expect(change(sliceRange(pts, "1W", now))).toEqual({ amount: 20, percent: 100, from: day(20) });
    expect(change([])).toEqual({ amount: 0, percent: null, from: null });
  });
});

describe("gradingOutlook", () => {
  it("prefers real graded prices and falls back to estimates", () => {
    const real = gradingOutlook(summary({ ungraded: 100, yourCopyValue: 85, graded: { "PSA 10": 900, "Grade 8": 120 }, estimatedGraded: { "PSA 9": 140 } }), DEFAULT_SETTINGS);
    expect(real).toMatchObject({ raw: 85, max: 900, maxLabel: "PSA 10", min: 120, minLabel: "Grade 8", fee: 25, upside: 790, downside: 10, fromRealData: true });
    const est = gradingOutlook(summary({ ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 10": 300, "PSA 8": 100 } }), DEFAULT_SETTINGS);
    expect(est).toMatchObject({ max: 300, min: 100, upside: 175, downside: -25, fromRealData: false });
    expect(gradingOutlook(summary({}), DEFAULT_SETTINGS)).toBeNull();
  });
});

describe("gradingVerdict", () => {
  const series = (upsides: number[]) =>
    outlookSeries(
      upsides.map((u, i) => snap(i, 1, i, { ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 10": 125 + u, "PSA 8": 100 } })),
      DEFAULT_SETTINGS,
    );
  it("says skip when even gem mint cannot cover the fee", () => {
    expect(gradingVerdict(series([-10])).kind).toBe("skip");
  });
  it("needs a few points before judging timing", () => {
    expect(gradingVerdict(series([50, 60])).kind).toBe("insufficient");
    expect(gradingVerdict([]).kind).toBe("insufficient");
  });
  it("flags prime when the upside is at or near its peak, wait when it has narrowed", () => {
    expect(gradingVerdict(series([20, 40, 60, 80])).kind).toBe("prime");
    expect(gradingVerdict(series([20, 80, 60, 40])).kind).toBe("wait");
    const v = gradingVerdict(series([20, 80, 60, 40]));
    expect(v.upsideVsPeak).toBeCloseTo(0.5);
  });
});

describe("chart utils", () => {
  it("ticks by time, not index, and never repeats a label", async () => {
    const { timeTicks, compactMoney } = await import("@/components/charts/chart-utils");
    const times = [0, 1, 2, 3, 30, 30.01].map((d) => d * 864e5);
    const xs = times.map((t) => (t / (30.01 * 864e5)) * 800);
    const labels = ["Jan 1", "Jan 2", "Jan 3", "Jan 4", "Jan 31", "Jan 31"];
    const ticks = timeTicks(times, xs, labels);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(4);
    expect(new Set(ticks.map((i) => labels[i])).size).toBe(ticks.length);
    expect(compactMoney(0)).toBe("$0");
    expect(compactMoney(1000)).toBe("$1,000");
    expect(compactMoney(12.5)).toBe("$12.50");
    expect(compactMoney(25000)).toBe("$25.0K");
  });
});
