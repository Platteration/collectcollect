import { describe, expect, it } from "vitest";
import { bucketSeries, gradingOutlook, performance as perf, gradingVerdict, outlookSeries, portfolioSeries, rangeSeries, sliceRange } from "@/lib/analytics";
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

describe("portfolioSeries over time", () => {
  const hour = (n: number) => new Date(Date.UTC(2026, 0, 1, n)).toISOString();
  const owned = (id: number, over: Partial<CardRecord> = {}): CardRecord =>
    ({ id, quantity: 1, game: "pokemon", name: `c${id}`, condition: "NM", grade: null, gradingCompany: null, purchasePrice: null, createdAt: day(0), ...over } as unknown as CardRecord);

  it("counts a card only from the day it was catalogued", () => {
    const cards = [owned(1), owned(2, { createdAt: day(3) })];
    const pts = portfolioSeries(cards, [snap(1, 1, 1, { yourCopyValue: 100 }), snap(2, 2, 4, { yourCopyValue: 50 })]);
    expect(pts.map((p) => [p.t, p.value])).toEqual([
      [day(1), 100],
      [day(3), 100], // card 2 joins the collection, still unpriced
      [day(4), 150],
    ]);
  });

  it("takes sold copies out on the day they sold, leaving the history before it alone", () => {
    const cards = [owned(1, { quantity: 1 })]; // two copies once, one sold
    const sales = [{ cardId: 1, quantity: 1, soldAt: day(3) }];
    const pts = portfolioSeries(cards, [snap(1, 1, 1, { yourCopyValue: 100 }), snap(2, 1, 5, { yourCopyValue: 120 })], sales);
    expect(pts.map((p) => [p.t, p.value, p.copies])).toEqual([
      [day(1), 200, 2],
      [day(3), 100, 1],
      [day(5), 120, 1],
    ]);
  });

  it("keeps a fully sold card in the past and drops it from the present", () => {
    const cards = [owned(1, { quantity: 0 })];
    const pts = portfolioSeries(cards, [snap(1, 1, 1, { yourCopyValue: 80 }), snap(2, 1, 6, { yourCopyValue: 90 })], [{ cardId: 1, quantity: 1, soldAt: day(4) }]);
    expect(pts.map((p) => [p.t, p.value, p.priced])).toEqual([
      [day(1), 80, 1],
      [day(4), 0, 0],
      [day(6), 0, 0],
    ]);
  });

  it("tracks the cost basis of the copies held, not of cards that have gone", () => {
    const cards = [owned(1, { quantity: 1, purchasePrice: 40 }), owned(2, { purchasePrice: null })];
    const pts = portfolioSeries(cards, [snap(1, 1, 1, { yourCopyValue: 100 }), snap(2, 2, 1, { yourCopyValue: 10 })], [{ cardId: 1, quantity: 1, soldAt: day(3) }]);
    expect(pts.map((p) => p.cost)).toEqual([80, 40]);
  });

  it("ignores a sale dated before the card was catalogued", () => {
    const pts = portfolioSeries([owned(1, { quantity: 1, createdAt: day(2) })], [snap(1, 1, 3, { yourCopyValue: 100 })], [{ cardId: 1, quantity: 1, soldAt: day(1) }]);
    expect(pts.map((p) => [p.t, p.value])).toEqual([[day(3), 100]]);
  });

  it("reads one close per bucket, so a refresh-all does not draw a staircase", () => {
    // Three cards re-priced seconds apart: one point for the day, at the end of it.
    const at = (s: number) => new Date(Date.UTC(2026, 0, 2, 12, 0, s)).toISOString();
    const pts = [day(0), at(0), at(1), at(2)].map((t, i) => ({ t, value: 100 + i }));
    expect(bucketSeries(pts, "day")).toEqual([
      { t: day(0), value: 100 },
      { t: at(2), value: 103 },
    ]);
    expect(bucketSeries(pts, "hour").map((p) => p.value)).toEqual([100, 103]);
  });

  it("counts a card being added, first priced or sold as flow, not as a move", () => {
    const cards = [owned(1, { quantity: 1 }), owned(2, { createdAt: day(2) })];
    const snaps = [snap(1, 1, 1, { yourCopyValue: 100 }), snap(2, 2, 3, { yourCopyValue: 40 }), snap(3, 1, 5, { yourCopyValue: 130 })];
    const pts = portfolioSeries(cards, snaps, [{ cardId: 1, quantity: 1, soldAt: day(6) }]);
    expect(pts.map((p) => [p.value, p.flows])).toEqual([
      [200, 200], // two copies priced for the first time
      [200, 200], // card 2 catalogued, still unpriced
      [240, 240], // card 2's first price is money in, not a gain
      [300, 240], // card 1 up 30 a copy: the only real move so far
      [170, 110], // one copy of card 1 sold at 130
    ]);
    // Over the whole series: 170 − 200 in value, but prices actually gained 60.
    const over = perf(pts[0], pts[pts.length - 1]);
    expect(over).toMatchObject({ amount: -30, flows: -90, move: 60 });
    expect(over.movePercent).toBe(38.71); // 60 / (200 − 45)
    // A window with nothing bought or sold is just the price move.
    expect(perf(pts[2], pts[3])).toMatchObject({ amount: 60, flows: 0, move: 60, movePercent: 25 });
  });

  it("plots a week by the hour and a year by the week", () => {
    const pts = [hour(0), hour(1), hour(2)].map((t, i) => ({ t, value: i }));
    expect(rangeSeries(pts, "1W", new Date(hour(3)).getTime())).toHaveLength(3);
    expect(rangeSeries([...pts, { t: day(20), value: 9 }], "1Y", new Date(day(21)).getTime()).map((p) => p.value)).toEqual([2, 9]);
  });
});

describe("sliceRange and performance", () => {
  const pts = [0, 10, 20, 40].map((d) => ({ t: day(d), value: d, flows: 0 }));
  const now = new Date(day(40)).getTime();
  it("keeps one point before the window so the line has a start", () => {
    expect(sliceRange(pts, "1M", now).map((p) => p.value)).toEqual([0, 10, 20, 40]);
    expect(sliceRange(pts, "1W", now).map((p) => p.value)).toEqual([20, 40]);
    expect(sliceRange(pts, "ALL", now)).toHaveLength(4);
  });
  it("computes the delta from the first visible point", () => {
    const week = sliceRange(pts, "1W", now);
    expect(perf(week[0], week[week.length - 1])).toMatchObject({ amount: 20, percent: 100, from: day(20) });
    expect(perf(undefined, undefined)).toEqual({ amount: 0, percent: null, from: null, flows: 0, move: 0, movePercent: null });
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

describe("expected grade from the photo", () => {
  it("prices the copy at the grade the photo suggests, real data before estimates", async () => {
    const { gradingOutlook } = await import("@/lib/analytics");
    const s = summary({ ungraded: 100, yourCopyValue: 100, graded: { "PSA 9": 210 }, estimatedGraded: { "PSA 10": 300, "PSA 8": 100 } });
    expect(gradingOutlook(s, DEFAULT_SETTINGS, "9")).toMatchObject({ likely: 210, likelyLabel: "PSA 9" });
    expect(gradingOutlook(s, DEFAULT_SETTINGS, "10")).toMatchObject({ likely: 300, likelyLabel: "PSA 10" });
    expect(gradingOutlook(s, DEFAULT_SETTINGS, "6")).toMatchObject({ likely: null, likelyLabel: null });
    expect(gradingOutlook(s, DEFAULT_SETTINGS, null)).toMatchObject({ likely: null });
    expect(gradingOutlook(s, DEFAULT_SETTINGS, "grade 9")).toMatchObject({ likely: 210 });
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

describe("returns and allocation", () => {
  const cards = [
    { ...card(1), purchasePrice: 100, game: "pokemon" },
    { ...card(2, 2), purchasePrice: 10, game: "yugioh" },
    { ...card(3), purchasePrice: null, game: "pokemon" },
  ] as CardRecord[];
  const values: Record<number, number | null> = { 1: 150, 2: 8, 3: 500 };
  it("computes total return only over cards with a known cost", async () => {
    const { totalReturn } = await import("@/lib/analytics");
    expect(totalReturn(cards, (c) => values[c.id])).toEqual({ invested: 120, valueOfInvested: 166, amount: 46, percent: 38.33, cardsWithCost: 2 });
    expect(totalReturn([], () => null).percent).toBeNull();
  });
  it("splits value by game, largest first", async () => {
    const { allocationByGame } = await import("@/lib/analytics");
    const a = allocationByGame(cards, (c) => values[c.id]);
    expect(a.map((x) => [x.game, x.value, x.cards])).toEqual([["pokemon", 650, 2], ["yugioh", 16, 1]]);
    expect(a[0].share).toBeCloseTo(650 / 666);
  });
});

describe("niceScale", () => {
  it("keeps the bounds it is given and puts the gridlines inside them", async () => {
    const { niceScale } = await import("@/components/charts/chart-utils");
    expect(niceScale(14900, 15300)).toEqual({ lo: 14900, hi: 15300, ticks: [15000, 15200] });
    // An empty series hands in Infinity; that has to end up as a drawable frame.
    expect(niceScale(Math.min(), Math.max())).toEqual({ lo: 0, hi: 1, ticks: [] });
    expect(niceScale(5, 5).ticks.length).toBeLessThanOrEqual(6);
  });
});
