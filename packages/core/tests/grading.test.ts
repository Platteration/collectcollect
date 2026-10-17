import { describe, expect, it } from "vitest";
import { CARD_GRADE_KEYS, gradingOutlook, gradingVerdict, isReadyToGrade, outlookSeries, type GradedSummary, type GradingSettings, type OutlookPoint } from "../src/grading";

/**
 * The grade-or-wait verdict the domain apps share. These are the card app's
 * own tests of the same rule (apps/cards/tests/analytics.test.ts and
 * valuation-transparency.test.ts), written against this module's API, so the
 * two cannot drift apart unnoticed.
 */

const settings: GradingSettings = { gradingFee: 25, readyMinUpside: 40, readyMinUpsidePercent: 50 };

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

const summaryOf = (over: Partial<GradedSummary>): GradedSummary => ({ ungraded: null, yourCopyValue: null, graded: {}, estimatedGraded: {}, ...over });

/** A snapshot whose gem-mint price leaves exactly `upside` after the fee. */
const snapAt = (id: number, fetchedAt: string, upside: number) => ({
  id,
  fetchedAt,
  summary: summaryOf({ ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 10": 125 + upside, "PSA 8": 100 } }),
});

/** One snapshot per day, one day apart, with these upsides. */
const series = (upsides: number[]) => outlookSeries(upsides.map((u, i) => snapAt(i, day(i), u)), settings);

describe("gradingOutlook", () => {
  it("prefers real graded prices and falls back to estimates", () => {
    const real = gradingOutlook(summaryOf({ ungraded: 100, yourCopyValue: 85, graded: { "PSA 10": 900, "Grade 8": 120 }, estimatedGraded: { "PSA 9": 140 } }), settings);
    expect(real).toMatchObject({ raw: 85, max: 900, maxLabel: "PSA 10", min: 120, minLabel: "Grade 8", fee: 25, upside: 790, downside: 10, fromRealData: true });
    const est = gradingOutlook(summaryOf({ ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 10": 300, "PSA 8": 100 } }), settings);
    expect(est).toMatchObject({ max: 300, min: 100, upside: 175, downside: -25, fromRealData: false });
    expect(gradingOutlook(summaryOf({}), settings)).toBeNull();
  });

  it("takes a TAG 10 price as the best case when it is the only 10 priced, and prices a TAG or SGC expected grade", () => {
    const tag = gradingOutlook(summaryOf({ ungraded: 100, yourCopyValue: 100, graded: { "TAG 10": 700, "TAG 8": 150 } }), settings, "8");
    expect(tag).toMatchObject({ max: 700, maxLabel: "TAG 10", likely: 150, likelyLabel: "TAG 8", min: 100, minLabel: "Ungraded" });
    const sgc = gradingOutlook(summaryOf({ ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 10": 300, "SGC 9": 120 } }), settings, "9");
    expect(sgc).toMatchObject({ likely: 120, likelyLabel: "SGC 9" });
    expect(CARD_GRADE_KEYS.maxKeys).toContain("TAG 10");
    expect(CARD_GRADE_KEYS.companies).toEqual(expect.arrayContaining(["SGC", "TAG"]));
  });

  it("prices the copy at the grade the photo suggests, real data before estimates", () => {
    const s = summaryOf({ ungraded: 100, yourCopyValue: 100, graded: { "PSA 9": 210 }, estimatedGraded: { "PSA 10": 300, "PSA 8": 100 } });
    expect(gradingOutlook(s, settings, "9")).toMatchObject({ likely: 210, likelyLabel: "PSA 9" });
    expect(gradingOutlook(s, settings, "10")).toMatchObject({ likely: 300, likelyLabel: "PSA 10" });
    expect(gradingOutlook(s, settings, "6")).toMatchObject({ likely: null, likelyLabel: null });
    expect(gradingOutlook(s, settings, null)).toMatchObject({ likely: null });
    expect(gradingOutlook(s, settings, "grade 9")).toMatchObject({ likely: 210 });
  });

  it("prices an expected grade by the companies of the key set it is given", () => {
    const s = summaryOf({ ungraded: 50, yourCopyValue: 50, graded: { "WATA 9.8 A+": 500, "WATA 9": 200 } });
    const keys = { maxKeys: ["WATA 9.8 A+"], minKeys: [], companies: ["WATA"] };
    expect(gradingOutlook(s, settings, "9", keys)).toMatchObject({ likely: 200, likelyLabel: "WATA 9" });
    // The card companies are not tried for a set that names its own.
    const asCard = summaryOf({ ungraded: 50, yourCopyValue: 50, graded: { "WATA 9.8 A+": 500, "PSA 9": 80 } });
    expect(gradingOutlook(asCard, settings, "9", keys)).toMatchObject({ likely: null });
  });
});

describe("gradingVerdict", () => {
  it("says skip when even gem mint cannot cover the fee", () => {
    expect(gradingVerdict(series([-10])).kind).toBe("skip");
  });

  it("says there is nothing to judge with no points, and not enough with two days", () => {
    expect(gradingVerdict([])).toMatchObject({ kind: "insufficient", headline: "No price data" });
    expect(gradingVerdict(series([50, 60])).kind).toBe("insufficient");
  });

  it("flags prime when the upside is at or near its peak, wait when it has narrowed", () => {
    expect(gradingVerdict(series([20, 40, 60, 80])).kind).toBe("prime");
    expect(gradingVerdict(series([20, 80, 60, 40])).kind).toBe("wait");
    expect(gradingVerdict(series([20, 80, 60, 40])).upsideVsPeak).toBeCloseTo(0.5);
  });

  it("does not treat three refreshes on the same day as three days of history", () => {
    const sameDay = ["2026-09-15T10:00:00.000Z", "2026-09-15T11:00:00.000Z", "2026-09-15T12:00:00.000Z"].map((at, id) => snapAt(id, at, 60));
    const verdict = gradingVerdict(outlookSeries(sameDay, settings));
    expect(verdict.kind).toBe("insufficient");
    expect(verdict.detail).toContain("at least three different days");
    // Six refreshes over two days are still two days.
    const twoDays = ["2026-09-14T09:00:00.000Z", "2026-09-14T10:00:00.000Z", "2026-09-14T11:00:00.000Z", "2026-09-15T09:00:00.000Z", "2026-09-15T10:00:00.000Z", "2026-09-15T11:00:00.000Z"].map((at, id) =>
      snapAt(id, at, 60 + id),
    );
    expect(gradingVerdict(outlookSeries(twoDays, settings)).kind).toBe("insufficient");
    // A third day is enough, however many refreshes the other two had.
    expect(gradingVerdict(outlookSeries([...twoDays, snapAt(9, "2026-09-16T09:00:00.000Z", 70)], settings)).kind).toBe("prime");
  });

  it("reads the last price of each day, so a price that was gone by evening is no peak", () => {
    // The second day touched 80 in the morning and was 30 by evening.
    const points = outlookSeries(
      [snapAt(1, day(0), 20), snapAt(2, `${day(1).slice(0, 10)}T08:00:00.000Z`, 80), snapAt(3, `${day(1).slice(0, 10)}T20:00:00.000Z`, 30), snapAt(4, day(2), 40)],
      settings,
    );
    const verdict = gradingVerdict(points);
    expect(verdict.kind).toBe("prime");
    expect(verdict.upsideVsPeak).toBe(1);
  });

  it("describes the history as recorded comparisons, claims no observed sales and predicts nothing", () => {
    const estimated = summaryOf({ ungraded: 100, yourCopyValue: 100, estimatedGraded: { "PSA 8": 110, "PSA 10": 500 } });
    const snapshots = [13, 14, 15].map((d, id) => ({ id, fetchedAt: `2026-09-${d}T12:00:00Z`, summary: estimated }));
    const verdict = gradingVerdict(outlookSeries(snapshots, settings));
    expect(verdict.kind).toBe("prime");
    expect(verdict.headline).toContain("recorded");
    expect(verdict.headline + verdict.detail).not.toContain("observed");
    expect(verdict.detail).toContain("does not predict the grade or a sale price");
    expect(gradingVerdict(series([20, 80, 60, 40])).detail).toContain("recorded");
  });

  it("finds the peak of two hundred thousand snapshots without a spread", () => {
    // One a minute for a hundred and forty days, the upside a dollar wider each day:
    // a spread over this overflows the stack, and the widest gap is the last one.
    const start = Date.UTC(2026, 0, 1);
    const points = Array.from({ length: 200_000 }, (_, i): OutlookPoint => {
      const upside = 100 + Math.floor(i / 1440);
      return {
        t: new Date(start + i * 60_000).toISOString(),
        raw: 100,
        min: 100,
        minLabel: "Ungraded",
        max: 125 + upside,
        maxLabel: "PSA 10",
        fee: 25,
        upside,
        downside: -25,
        fromRealData: true,
        likely: null,
        likelyLabel: null,
      };
    });
    const started = Date.now();
    const verdict = gradingVerdict(points);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(verdict.kind).toBe("prime");
    expect(verdict.upsideVsPeak).toBe(1);
  });
});

describe("when a copy is ready to grade", () => {
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
    const ready = { ...settings, readyMinUpside: 40, readyMinUpsidePercent: 50 };
    expect(isReadyToGrade([point(100, 80)], prime, ready)).toBe(true);
    // Right timing, but $30 of upside is under the $40 floor.
    expect(isReadyToGrade([point(100, 30)], prime, ready)).toBe(false);
    // Enough money, but 45% of the raw price is under the 50% floor.
    expect(isReadyToGrade([point(100, 45)], prime, ready)).toBe(false);
    // Everything but the timing.
    expect(isReadyToGrade([point(100, 80)], wait, ready)).toBe(false);
    // Nothing to judge.
    expect(isReadyToGrade([], prime, ready)).toBe(false);
    // A copy with no raw price cannot fail the percentage test.
    expect(isReadyToGrade([point(0, 80)], prime, ready)).toBe(true);
  });

  it("is not ready after three refreshes in one day, whatever the upside", () => {
    const sameDay = [10, 11, 12].map((hour, id) => snapAt(id, `2026-09-15T${hour}:00:00.000Z`, 80));
    const outlook = outlookSeries(sameDay, settings);
    expect(isReadyToGrade(outlook, gradingVerdict(outlook), settings)).toBe(false);
  });
});
