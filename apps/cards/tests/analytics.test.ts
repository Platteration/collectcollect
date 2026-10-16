import { describe, expect, it } from "vitest";
import { OUTLOOK_POINTS, OUTLOOK_SHOWN, allocationByGame, bucketFor, bucketSeries, capOutlook, outlookForChart, change, gradingOutlook, gradingVerdict, isReadyToGrade, outlookSeries, performance, portfolioSeries, rangeSeries, realizedReturn, sliceRange, totalReturn, valueTimeline } from "@/lib/analytics";
import type { HoldingsEvent } from "@collectcollect/core/holdings-history";
import { niceScale, tickLabels } from "@collectcollect/core/charts/chart-utils";
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
  it("reaches the last time the prices were confirmed, not only the last change", () => {
    const pts = portfolioSeries([card(1)], [{ ...snap(1, 1, 0, { yourCopyValue: 5 }), checkedAt: day(9) }]);
    expect(pts.map((p) => p.t)).toEqual([day(0), day(9)]);
    expect(pts[1]).toMatchObject({ value: 5, priced: 1 });
    // A check older than a later change adds nothing.
    const later = portfolioSeries([card(1)], [{ ...snap(1, 1, 0, { yourCopyValue: 5 }), checkedAt: day(3) }, snap(2, 1, 5, { yourCopyValue: 6 })]);
    expect(later.map((p) => p.t)).toEqual([day(0), day(5)]);
  });

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
    expect(pts[2]?.priced).toBe(2);
  });
  it("collapses snapshots taken at the same instant", () => {
    const pts = portfolioSeries([card(1), card(2)], [snap(1, 1, 0, { yourCopyValue: 5 }), snap(2, 2, 0, { yourCopyValue: 7 })]);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.value).toBe(12);
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

describe("what a measured centering does to the outlook", () => {
  const measured = (lr: [number, number]) => ({ front: { lr, tb: null }, back: { lr: null, tb: null } });
  it("caps the best case and the likely grade at what the centering allows, and leaves a card with no centering alone", () => {
    const s = summary({ ungraded: 100, yourCopyValue: 100, graded: { "PSA 10": 900, "PSA 9": 210 }, estimatedGraded: { "PSA 8": 100 } });
    const capped = gradingOutlook(s, DEFAULT_SETTINGS, "10", measured([60, 40]), "pokemon")!;
    expect(capped).toMatchObject({ max: 210, maxLabel: "PSA 9", upside: 85, likely: 210, likelyLabel: "PSA 9", min: 100, minLabel: "PSA 8" });
    expect(capped.provenance?.centeringCap).toMatchObject({ company: "PSA", grade: 9, label: "PSA 9", reason: "front 60/40 left-right" });
    expect(capped.provenance?.max).toBe("observed");
    // Within the limits for a 10: nothing changes, and the cap is not reported.
    const fine = gradingOutlook(s, DEFAULT_SETTINGS, "10", measured([55, 45]), "pokemon")!;
    expect(fine).toMatchObject({ max: 900, maxLabel: "PSA 10", likely: 900 });
    expect(fine.provenance?.centeringCap).toBeNull();
    // Nothing measured: exactly what the card got before.
    expect(gradingOutlook(s, DEFAULT_SETTINGS, "10", null)).toEqual(gradingOutlook(s, DEFAULT_SETTINGS, "10"));
    expect(gradingOutlook(s, DEFAULT_SETTINGS, "10", { front: { lr: null, tb: null }, back: { lr: [60, 40], tb: null } })).toEqual(gradingOutlook(s, DEFAULT_SETTINGS, "10"));
    // A series carries the same cap to every point, so the verdict sees it.
    const series = outlookSeries([snap(1, 1, 0, s), snap(2, 1, 1, s)], DEFAULT_SETTINGS, null, measured([60, 40]), "pokemon");
    expect(series.map((p) => p.max)).toEqual([210, 210]);
  });

  it("prices the cap at the next grade down when the capped grade has no price, and at the mid case when nothing is priced under it", () => {
    const s = summary({ ungraded: 100, yourCopyValue: 100, graded: { "PSA 10": 900 }, estimatedGraded: { "PSA 8": 120, "PSA 7": 90 } });
    // 60/40 allows a 9; nothing is priced at 9 or 8.5, so the 8 stands in.
    expect(gradingOutlook(s, DEFAULT_SETTINGS, null, measured([60, 40]))).toMatchObject({ max: 120, maxLabel: "PSA 8", min: 120, minLabel: "PSA 8" });
    // 70/30 allows a 7 at most, and the 7 is priced.
    expect(gradingOutlook(s, DEFAULT_SETTINGS, null, measured([70, 30]))).toMatchObject({ max: 90, maxLabel: "PSA 7", upside: -35 });
    // 95/5 allows a 2; nothing is priced that low, so the best case is the mid case.
    const floor = gradingOutlook(s, DEFAULT_SETTINGS, "9", measured([95, 5]))!;
    expect(floor).toMatchObject({ max: 120, maxLabel: "PSA 8", likely: null, likelyLabel: null });
    expect(floor.provenance?.centeringCap).toMatchObject({ grade: 2 });
  });
});

describe("TAG and SGC in the outlook", () => {
  it("takes a TAG 10 price as a best case when it is the only 10 priced, and prices a TAG or SGC expected grade", () => {
    const tag = gradingOutlook(summary({ ungraded: 100, yourCopyValue: 100, graded: { "TAG 10": 700, "TAG 8": 150 }, estimatedGraded: {} }), DEFAULT_SETTINGS, "8")!;
    expect(tag).toMatchObject({ max: 700, maxLabel: "TAG 10", likely: 150, likelyLabel: "TAG 8", min: 100, minLabel: "Ungraded" });
    const sgc = gradingOutlook(summary({ ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 10": 300, "SGC 9": 120 } }), DEFAULT_SETTINGS, "9")!;
    expect(sgc).toMatchObject({ likely: 120, likelyLabel: "SGC 9" });
    // The defaults estimate TAG grades on a fresh install.
    expect(DEFAULT_SETTINGS.gradeMultipliers["TAG 10"]).toBe(3);
    expect(DEFAULT_SETTINGS.gradeMultipliers["TAG 9"]).toBe(1.3);
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
    const { timeTicks, compactMoney } = await import("@collectcollect/core/charts/chart-utils");
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
    expect(totalReturn(cards, (c) => values[c.id] ?? null, basisOf)).toEqual({
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
    const a = allocationByGame(cards, (c) => values[c.id] ?? null);
    expect(a.map((x) => [x.game, x.value, x.cards])).toEqual([["pokemon", 650, 2], ["yugioh", 16, 1]]);
    expect(a[0]?.share).toBeCloseTo(650 / 666);
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


describe("a long history", () => {
  it("builds a series over two hundred thousand snapshots that agrees with summing every card", () => {
    const cards = Array.from({ length: 400 }, (_, i) => card(i + 1, (i % 3) + 1));
    const snapshots: PriceSnapshot[] = [];
    for (let k = 0; k < 200_000; k++) {
      const cardId = (k % 400) + 1;
      const value = ((k * 7) % 50) / 10;
      snapshots.push({ id: k + 1, cardId, fetchedAt: new Date(Date.UTC(2025, 0, 1) + k * 60_000).toISOString(), summary: summary({ yourCopyValue: value, ungraded: value / 2 }) });
    }
    const started = Date.now();
    const series = portfolioSeries(cards, snapshots);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(series).toHaveLength(200_000);

    for (const index of [0, 399, 4_321, 123_456, 199_999]) {
      const latest = new Map<number, number>();
      for (let k = 0; k <= index; k++) {
        const snap = snapshots[k]!;
        latest.set(snap.cardId, (snap.summary.yourCopyValue ?? 0) * cards[snap.cardId - 1]!.quantity);
      }
      let sum = 0;
      let priced = 0;
      for (const v of latest.values()) {
        sum += v;
        if (v > 0) priced++;
      }
      expect(series[index]!.value).toBeCloseTo(Math.round(sum * 100) / 100, 1);
      expect(series[index]!.priced).toBe(priced);
    }
  });

  it("scales a chart over two hundred thousand points without a spread", async () => {
    const { xScale, timeTicks } = await import("@collectcollect/core/charts/chart-utils");
    const times = Array.from({ length: 200_000 }, (_, i) => i * 60_000);
    const layout = { width: 800, height: 200, left: 10, right: 10, top: 10, bottom: 10 };
    const x = xScale(times, layout);
    expect(x(0)).toBe(10);
    expect(x(times[times.length - 1]!)).toBe(790);
    const xs = times.map(x);
    expect(timeTicks(times, xs, times.map(String)).length).toBeGreaterThan(1);
  });
});

describe("what an outlook chart is sent", () => {
  it("is at most thirty points, still ending on the newest one the verdict read", () => {
    const point = (i: number): OutlookPoint => ({ t: day(i), raw: 10 + i, min: 20, max: 40 + i, minLabel: "PSA 8", maxLabel: "PSA 10", fee: 20, upside: 10 + i, expected: null, expectedLabel: null, basis: { rawSource: "x", gradedSource: null, estimatedGrades: [] } } as unknown as OutlookPoint);
    const ninety = Array.from({ length: 90 }, (_, i) => point(i));
    const sent = outlookForChart(ninety);
    expect(sent).toHaveLength(OUTLOOK_POINTS);
    expect(sent[0]).toBe(ninety[0]);
    expect(sent.at(-1)).toBe(ninety.at(-1));
    expect(outlookForChart(ninety.slice(0, 5))).toEqual(ninety.slice(0, 5));
  });
});

describe("how many outlook charts are drawn", () => {
  it("draws the first twelve and says how many more there are, until asked for all", () => {
    const many = Array.from({ length: OUTLOOK_SHOWN + 5 }, (_, i) => i);
    expect(capOutlook(many, false)).toEqual({ shown: many.slice(0, OUTLOOK_SHOWN), hidden: 5 });
    expect(capOutlook(many, true)).toEqual({ shown: many, hidden: 0 });
    const few = [1, 2, 3];
    expect(capOutlook(few, false)).toEqual({ shown: few, hidden: 0 });
    expect(capOutlook(many, false, 3)).toEqual({ shown: [0, 1, 2], hidden: OUTLOOK_SHOWN + 2 });
  });
});

// ---------------------------------------------------------------------------
// The recorded value of the collection (the value timeline)
// ---------------------------------------------------------------------------

/** One step of the holdings record: after it, the card has `quantity` copies, each worth `unit`. */
const step = (entityId: number, d: number, quantity: number, unit: number | null, raw: number | null = unit): HoldingsEvent => ({
  entityId,
  recordedAt: day(d),
  quantity,
  unitValue: unit,
  rawUnitValue: raw,
});
const ledger = (...events: HoldingsEvent[]) => ({ startedAt: day(0), events });
const noCost = () => undefined;

describe("valueTimeline: holdings and flows", () => {
  it("counts a card only from the step that added it, and takes sold copies out at the step that sold them", () => {
    const pts = valueTimeline(ledger(step(1, 0, 1, 100), step(2, 3, 1, null), step(2, 4, 1, 50), step(1, 6, 0, 100)), noCost);
    expect(pts.map((p) => [p.t, p.value, p.copies, p.priced, p.unpriced])).toEqual([
      [day(0), 100, 1, 1, 0],
      [day(3), 100, 2, 1, 1], // card 2 joins the collection, still unpriced
      [day(4), 150, 2, 2, 0],
      [day(6), 50, 1, 1, 0], // card 1 sold: its past stays, its present goes
    ]);
  });

  it("counts a card being added, first priced or sold as flow, not as a move", () => {
    const pts = valueTimeline(ledger(step(1, 0, 2, null), step(1, 1, 2, 100), step(2, 2, 1, null), step(2, 3, 1, 40), step(1, 5, 2, 130), step(1, 6, 1, 130)), noCost);
    expect(pts.map((p) => [p.value, p.flows])).toEqual([
      [0, 0], // two copies catalogued, nothing priced
      [200, 200], // priced for the first time: money in, not a gain
      [200, 200], // card 2 catalogued, still unpriced
      [240, 240], // card 2's first price
      [300, 240], // card 1 up 30 a copy: the only real move so far
      [170, 110], // one copy of card 1 sold at 130
    ]);
    // Over the pricing and after: 170 − 200 in value, but prices actually gained 60.
    const over = performance(pts[1], pts[5]);
    expect(over).toMatchObject({ amount: -30, flows: -90, move: 60 });
    expect(over.movePercent).toBe(38.71); // 60 / (200 − 45)
    // A window with nothing bought or sold is just the price move.
    expect(performance(pts[3], pts[4])).toMatchObject({ amount: 60, flows: 0, move: 60, movePercent: 25 });
  });

  it("gives back what a sale took when the sale is undone", () => {
    const pts = valueTimeline(ledger(step(1, 0, 1, 10), step(1, 1, 0, 10), step(1, 2, 1, 10)), noCost);
    expect(pts.map((p) => [p.value, p.flows, p.copies])).toEqual([[10, 10, 1], [0, 0, 0], [10, 10, 1]]);
  });

  it("reads a price that goes away as the market, since the copies are still held", () => {
    const pts = valueTimeline(ledger(step(1, 0, 1, 50), step(1, 1, 1, null)), noCost);
    expect(pts.map((p) => [p.value, p.flows, p.priced, p.unpriced])).toEqual([[50, 50, 1, 0], [0, 50, 0, 1]]);
  });

  it("makes steps recorded in the same instant one point, and opens at zero when nothing is held", () => {
    expect(valueTimeline(ledger(), noCost)).toEqual([{ t: day(0), value: 0, ungraded: 0, priced: 0, unpriced: 0, copies: 0, cost: 0, costedValue: 0, flows: 0 }]);
    const pts = valueTimeline(ledger(step(1, 1, 1, 5), step(2, 1, 1, 7), step(1, 2, 1, 6)), noCost);
    expect(pts.map((p) => [p.t, p.value, p.flows])).toEqual([[day(0), 0, 0], [day(1), 12, 12], [day(2), 13, 12]]);
  });

  it("carries the raw value of the copies held beside the value they are carried at", () => {
    const pts = valueTimeline(ledger(step(1, 0, 3, 100, 80), step(1, 1, 2, 100, 90)), noCost);
    expect(pts.map((p) => [p.value, p.ungraded])).toEqual([[300, 240], [200, 180]]);
  });
});

describe("valueTimeline: the cost of what was held", () => {
  const rates = new Map([[1, { unitCost: 40, copies: 2 }], [3, { unitCost: 10, copies: 1 }]]);
  const rateOf = (id: number) => rates.get(id);

  it("tracks the cost of the copies held, and of nothing that has gone", () => {
    const pts = valueTimeline(ledger(step(1, 0, 2, null), step(1, 1, 2, 100), step(1, 3, 1, 100)), rateOf);
    expect(pts.map((p) => [p.cost, p.costedValue])).toEqual([
      [0, 0], // not priced yet: a card awaiting its first price is not a loss
      [80, 200],
      [40, 100], // one copy sold, and its cost with it
    ]);
  });

  it("leaves out cards with no recorded cost, and copies beyond the ones that ever had one", () => {
    // Card 2 has no rate; card 3 holds three copies of which one ever had a cost.
    const pts = valueTimeline(ledger(step(2, 0, 1, 500), step(3, 1, 3, 20)), rateOf);
    expect(pts.map((p) => [p.value, p.cost, p.costedValue])).toEqual([
      [500, 0, 0],
      [560, 10, 20],
    ]);
  });

  it("measures the gain over the same copies on both sides, as the unrealized return does", () => {
    const pts = valueTimeline(ledger(step(1, 0, 2, 100), step(2, 0, 1, 500)), rateOf);
    const last = pts.at(-1);
    // 700 of value, but the gain is over card 1 alone: 200 against the 80 paid.
    expect(last).toMatchObject({ value: 700, cost: 80, costedValue: 200 });
    const returns = totalReturn([card(1, 2)], () => 100, () => ({ invested: 80, copiesWithCost: 2, copiesWithoutCost: 0 }));
    expect((last?.costedValue ?? 0) - (last?.cost ?? 0)).toBe(returns.amount);
  });
});

describe("bucketSeries and rangeSeries", () => {
  const hour = (n: number) => new Date(Date.UTC(2026, 0, 1, n)).toISOString();

  it("reads one close per bucket, so a refresh-all does not draw a staircase", () => {
    // Three cards re-priced seconds apart: one point for the day, at the end of it.
    const at = (s: number) => new Date(Date.UTC(2026, 0, 2, 12, 0, s)).toISOString();
    const pts = [day(0), at(0), at(1), at(2)].map((t, i) => ({ t, value: 100 + i }));
    expect(bucketSeries(pts, "day")).toEqual([
      { t: day(0), value: 100 },
      { t: at(2), value: 103 },
    ]);
    expect(bucketSeries(pts, "hour").map((p) => p.value)).toEqual([100, 103]);
    expect(bucketSeries([], "day")).toEqual([]);
  });

  it("keeps the last point of a bucket, with the running totals it carries", () => {
    const sixAm = { ...step(1, 0, 1, 11), recordedAt: hour(6) };
    const pts = valueTimeline(ledger(step(1, 0, 1, 10), sixAm, step(2, 1, 1, 5)), noCost);
    // The two steps inside day 0 are one close; the flows are cumulative, so the close carries all of them.
    expect(bucketSeries(pts, "day").map((p) => [p.t, p.value, p.flows])).toEqual([[hour(6), 11, 10], [day(1), 16, 15]]);
  });

  it("plots a week by the hour, a quarter by the day and a year by the week", () => {
    const pts = [hour(0), hour(1), hour(2)].map((t, i) => ({ t, value: i }));
    expect(rangeSeries(pts, "1W", new Date(hour(3)).getTime())).toHaveLength(3);
    const at = (d: number, h: number, value: number) => ({ t: new Date(Date.UTC(2026, 0, 1 + d, h)).toISOString(), value });
    expect(rangeSeries([...pts, at(1, 6, 10), at(1, 18, 11), at(2, 12, 20)], "3M", new Date(day(3)).getTime()).map((p) => p.value)).toEqual([2, 11, 20]);
    expect(rangeSeries([...pts, { t: day(20), value: 9 }], "1Y", new Date(day(21)).getTime()).map((p) => p.value)).toEqual([2, 9]);
  });

  it("falls back to a finer bucket for a collection too new to have closed a day, rather than drawing one dot", () => {
    const now = new Date(hour(8)).getTime();
    // Everything recorded in one morning: a week of hours is two or three points, a month of days would be one.
    const morning = [hour(1), hour(2), hour(2), hour(3)].map((t, i) => ({ t: new Date(new Date(t).getTime() + i * 1000).toISOString(), value: i }));
    expect(rangeSeries(morning, "1M", now).map((p) => p.value)).toEqual([0, 2, 3]);
    expect(rangeSeries(morning, "1Y", now).map((p) => p.value)).toEqual([0, 2, 3]);
    // Within a single hour there is nothing finer than the points as they were recorded.
    const minutes = [0, 1, 2].map((m) => ({ t: new Date(Date.UTC(2026, 0, 1, 1, m)).toISOString(), value: m }));
    expect(rangeSeries(minutes, "1W", now).map((p) => p.value)).toEqual([0, 1, 2]);
    // One point stays one point.
    expect(rangeSeries(minutes.slice(0, 1), "1M", now)).toHaveLength(1);
    expect(rangeSeries([], "1M", now)).toEqual([]);
  });

  it("reads ALL at the bucket the history's length calls for", () => {
    const span = (days: number) => [{ t: day(0) }, { t: day(days) }];
    expect(bucketFor("ALL", span(10))).toBe("hour");
    expect(bucketFor("ALL", span(100))).toBe("day");
    expect(bucketFor("ALL", span(400))).toBe("week");
    expect(bucketFor("ALL", [])).toBe("hour");
  });
});

describe("performance", () => {
  it("is the plain change when nothing was added or sold, and says so when it was", () => {
    const a = { t: day(0), value: 100, flows: 100 };
    const b = { t: day(5), value: 130, flows: 100 };
    expect(performance(a, b)).toEqual({ amount: 30, percent: 30, from: day(0), flows: 0, move: 30, movePercent: 30 });
    // Cards worth 50 arrive in the window and prices gain 10: the plain 40 is not the market's.
    const c = { t: day(5), value: 160, flows: 150 };
    expect(performance(a, c)).toMatchObject({ amount: 60, percent: 60, flows: 50, move: 10 });
    expect(performance(a, c).movePercent).toBe(8); // 10 / (100 + 25)
  });

  it("measures a point against itself as no change, and a window with no points as none at all", () => {
    expect(performance({ t: day(0), value: 100 }, { t: day(0), value: 100 })).toMatchObject({ amount: 0, percent: 0, flows: 0, move: 0 });
    expect(performance(undefined, undefined)).toEqual({ amount: 0, percent: null, from: null, flows: 0, move: 0, movePercent: null });
    expect(change([{ t: day(0), value: 100 }])).toEqual({ amount: 0, percent: null, from: null });
  });

  it("has no percentage to give from nothing", () => {
    const from = { t: day(0), value: 0, flows: 0 };
    expect(performance(from, { t: day(1), value: 50, flows: 50 })).toMatchObject({ amount: 50, percent: null, flows: 50, move: 0 });
    expect(performance(from, { t: day(1), value: 50, flows: 50 }).movePercent).toBe(0);
    expect(performance(from, { t: day(1), value: 0, flows: 0 }).movePercent).toBeNull();
  });
});

describe("niceScale and tickLabels", () => {
  it("keeps the bounds it is given and puts the gridlines inside them", () => {
    expect(niceScale(14900, 15300)).toEqual({ lo: 14900, hi: 15300, ticks: [15000, 15200] });
    // An empty series hands in Infinity; that has to end up as a drawable frame.
    expect(niceScale(Math.min(), Math.max())).toEqual({ lo: 0, hi: 1, ticks: [] });
    expect(niceScale(5, 5).ticks.length).toBeLessThanOrEqual(6);
  });

  it("stops at a few gridlines when the bounds are too large for a step to move them", () => {
    // Beside 2^59 the gap between floats is 128 and the step is 50: adding it changes nothing, for ever.
    const huge = 2 ** 59;
    expect(huge + 128).toBeGreaterThan(huge);
    expect(niceScale(huge, huge + 128).ticks.length).toBeLessThanOrEqual(7);
  });

  it("labels gridlines in compact money, and in full when compact forms would repeat", () => {
    expect(tickLabels([15000, 15200])).toEqual(["$15.0K", "$15.2K"]);
    expect(tickLabels([15000, 15005, 15010])).toEqual(["$15,000", "$15,005", "$15,010"]);
    expect(tickLabels([150, 150.2, 150.4])).toEqual(["$150.00", "$150.20", "$150.40"]);
    expect(tickLabels([])).toEqual([]);
  });
});
