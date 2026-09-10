import { describe, expect, it } from "vitest";
import { allocationByGame, change, gradingOutlook, gradingVerdict, isReadyToGrade, outlookSeries, portfolioSeries, realizedReturn, sliceRange, totalReturn } from "@/lib/analytics";
import { DEFAULT_SETTINGS, type CardRecord, type PriceSnapshot, type PriceSummary } from "@/lib/types";
import type { OutlookPoint } from "@/lib/analytics";

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
  /** Cost basis in the shape the lots produce: one price per copy held. */
  const basisOf = (c: CardRecord) =>
    c.purchasePrice === null || c.purchasePrice < 0
      ? { invested: 0, copiesWithCost: 0, copiesWithoutCost: c.quantity }
      : { invested: c.purchasePrice * c.quantity, copiesWithCost: c.quantity, copiesWithoutCost: 0 };
  it("computes total return only over cards with a known cost", async () => {
    const { totalReturn } = await import("@/lib/analytics");
    expect(totalReturn(cards, (c) => values[c.id], basisOf)).toEqual({
      invested: 120,
      valueOfInvested: 166,
      amount: 46,
      percent: 38.33,
      cardsWithCost: 2,
      cardsAwaitingPrice: 0,
      copiesWithoutCost: 1,
    });
    expect(totalReturn([], () => null, basisOf).percent).toBeNull();
  });
  it("splits value by game, largest first", async () => {
    const { allocationByGame } = await import("@/lib/analytics");
    const a = allocationByGame(cards, (c) => values[c.id]);
    expect(a.map((x) => [x.game, x.value, x.cards])).toEqual([["pokemon", 650, 2], ["yugioh", 16, 1]]);
    expect(a[0].share).toBeCloseTo(650 / 666);
  });
});

describe("ranges with nothing recent in them", () => {
  it("still shows the last known value when every point is older than the window", () => {
    const points = [
      { t: day(0), value: 10 },
      { t: day(1), value: 20 },
    ];
    const now = new Date(Date.UTC(2026, 6, 1)).getTime();
    expect(sliceRange(points, "1W", now)).toEqual([points[1]]);
    expect(sliceRange(points, "ALL", now)).toHaveLength(2);
    expect(sliceRange([], "1W", now)).toEqual([]);
  });

  it("reports a fall as a fall", () => {
    expect(change([{ t: day(0), value: 200 }, { t: day(1), value: 150 }])).toMatchObject({ amount: -50, percent: -25 });
    // Nothing to divide by: a percentage would be a lie, so there isn't one.
    expect(change([{ t: day(0), value: 0 }, { t: day(1), value: 40 }])).toMatchObject({ amount: 40, percent: null });
  });
});

describe("what the return figures leave out", () => {
  const card = (over: Partial<CardRecord>): CardRecord =>
    ({ id: 1, game: "pokemon", name: "C", quantity: 1, purchasePrice: null, ...over }) as CardRecord;
  const basisOf = (c: CardRecord) =>
    c.purchasePrice === null || c.purchasePrice < 0
      ? { invested: 0, copiesWithCost: 0, copiesWithoutCost: c.quantity }
      : { invested: c.purchasePrice * c.quantity, copiesWithCost: c.quantity, copiesWithoutCost: 0 };

  it("does not count a card as a total loss just because it has no price yet", () => {
    const cards = [card({ id: 1, purchasePrice: 100 }), card({ id: 2, purchasePrice: 50 })];
    const priced = new Map([[1, 130]]);
    const r = totalReturn(cards, (c) => priced.get(c.id) ?? null, basisOf);
    expect(r).toMatchObject({ invested: 100, valueOfInvested: 130, amount: 30, percent: 30, cardsWithCost: 1, cardsAwaitingPrice: 1 });
  });

  it("counts only the copies whose cost is known, on both sides", () => {
    // Three copies, but only one of them has a recorded price. Counting all
    // three against one copy's cost would invent a 200% gain.
    const mixed = [card({ id: 1, quantity: 3 })];
    const r = totalReturn(mixed, () => 50, () => ({ invested: 40, copiesWithCost: 1, copiesWithoutCost: 2 }));
    expect(r).toMatchObject({ invested: 40, valueOfInvested: 50, amount: 10, percent: 25, copiesWithoutCost: 2 });
  });

  it("leaves out cards with no purchase price, and negative ones", () => {
    const cards = [card({ id: 1, purchasePrice: 20, quantity: 3 }), card({ id: 2 }), card({ id: 3, purchasePrice: -5 })];
    const r = totalReturn(cards, () => 25, basisOf);
    expect(r).toMatchObject({ invested: 60, valueOfInvested: 75, cardsWithCost: 1, cardsAwaitingPrice: 0 });
    expect(totalReturn([], () => 10, basisOf)).toMatchObject({ invested: 0, amount: 0, percent: null, cardsWithCost: 0 });
  });

  it("says how many sales it could not price the basis of", () => {
    const r = realizedReturn([
      { quantity: 2, unitPrice: 100, fees: 10, unitCost: 40 },
      { quantity: 1, unitPrice: 50, fees: 0, unitCost: null },
      // A basis of zero is a recorded basis: free cards are not unknown cards.
      { quantity: 1, unitPrice: 30, fees: 0, unitCost: 0 },
    ]);
    expect(r).toMatchObject({ proceeds: 280, fees: 10, cost: 80, gain: 190, sales: 3, copies: 4, withoutCost: 1 });
    expect(realizedReturn([])).toMatchObject({ proceeds: 0, gain: 0, percent: null, sales: 0 });
  });

  it("splits the collection by game, largest first", () => {
    const cards = [
      card({ id: 1, game: "pokemon" }),
      card({ id: 2, game: "pokemon" }),
      card({ id: 3, game: "mtg" }),
      card({ id: 4, game: "yugioh" }),
    ];
    const value = new Map([[1, 100], [2, 100], [3, 400], [4, 0]]);
    const split = allocationByGame(cards, (c) => value.get(c.id) ?? null);
    expect(split.map((a) => [a.game, a.value, a.cards, a.share])).toEqual([
      ["mtg", 400, 1, 0.6666666666666666],
      ["pokemon", 200, 2, 0.3333333333333333],
      ["yugioh", 0, 1, 0],
    ]);
    expect(allocationByGame([], () => null)).toEqual([]);
    // Nothing priced yet: shares are zero rather than NaN.
    expect(allocationByGame(cards, () => null).every((a) => a.share === 0)).toBe(true);
  });
});

describe("when a card is ready to grade", () => {
  const settings = { ...DEFAULT_SETTINGS, readyMinUpside: 40, readyMinUpsidePercent: 50 };
  const prime = { kind: "prime", headline: "", detail: "", upsideVsPeak: 1 } as const;
  const wait = { kind: "wait", headline: "", detail: "", upsideVsPeak: 0.5 } as const;
  const point = (raw: number, upside: number): OutlookPoint => ({
    t: day(0),
    raw,
    min: raw,
    minLabel: "PSA 8",
    max: raw + upside + 25,
    maxLabel: "PSA 10",
    fee: 25,
    upside,
    downside: -25,
    fromRealData: true,
    likely: null,
    likelyLabel: null,
  });

  it("wants the timing, the money and the percentage all to line up", () => {
    expect(isReadyToGrade([point(100, 80)], prime, settings)).toBe(true);
    // Right timing, but $30 of upside is under the $40 floor.
    expect(isReadyToGrade([point(100, 30)], prime, settings)).toBe(false);
    // Enough money, but 45% of the raw price is under the 50% floor.
    expect(isReadyToGrade([point(100, 45)], prime, settings)).toBe(false);
    // Everything but the timing.
    expect(isReadyToGrade([point(100, 80)], wait, settings)).toBe(false);
    // Nothing to judge.
    expect(isReadyToGrade([], prime, settings)).toBe(false);
    // A card with no raw price cannot fail the percentage test.
    expect(isReadyToGrade([point(0, 80)], prime, settings)).toBe(true);
  });
});

