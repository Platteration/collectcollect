import type { HoldingsEvent } from "@collectcollect/core/holdings-history";
import { extent, thinPoints } from "@collectcollect/core/series";
import type { CostBasis, CostRate } from "./acquisitions";
import type { CardRecord, Centering, Game, PriceSnapshot, PriceSummary, Settings } from "./types";
import { round2 } from "./pricing/match";
import { highestGradeAllowed, type CenteringCap } from "./grading/centering";

// ---------------------------------------------------------------------------
// Portfolio value over time
// ---------------------------------------------------------------------------

export interface PortfolioPoint {
  /** ISO timestamp */
  t: string;
  /** Sum of yourCopyValue × quantity using the latest snapshot per card at this time. */
  value: number;
  /** Sum of ungraded × quantity (what the collection would be worth raw NM). */
  ungraded: number;
  /** Cards that had a price at this point. */
  priced: number;
  /**
   * The rest are known to the recorded holdings history (`valueTimeline`) and
   * not to the price history of today's holdings, which has no record of what
   * was held when. A chart draws what it is given.
   */
  /** Copies held at this point. */
  copies?: number;
  /** What the copies counted in `costedValue` cost. */
  cost?: number;
  /**
   * What the copies whose cost is recorded were worth, among the cards with a
   * price. The gap between this and `cost` is the unrealized gain, counted over
   * the same copies on both sides, as `totalReturn` does.
   */
  costedValue?: number;
  /**
   * Running total of value that joined (or left) the collection without a price
   * moving: a card first priced, copies bought or sold. What is not flow is
   * the market moving.
   */
  flows?: number;
}

/**
 * Build a step series of total collection value. Each snapshot changes one
 * card's contribution; totals are recomputed at every snapshot time using the
 * most recent snapshot of every card. Quantities are taken from the cards as
 * they are now. Actual holdings history is recorded separately.
 */
/** What the portfolio line needs of a snapshot: a `PriceSnapshot`, or the two figures read out of one. */
export interface PortfolioInput {
  id: number;
  cardId: number;
  fetchedAt: string;
  checkedAt?: string;
  summary: Pick<PriceSummary, "yourCopyValue" | "ungraded">;
}

export function portfolioSeries(cards: Array<Pick<CardRecord, "id" | "quantity">>, snapshots: PortfolioInput[]): PortfolioPoint[] {
  const qty = new Map(cards.map((c) => [c.id, c.quantity]));
  const current = new Map<number, { value: number; ungraded: number }>();
  const points: PortfolioPoint[] = [];
  const sorted = [...snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id);
  // Running totals: each snapshot replaces one card's contribution, so the
  // whole is adjusted by the difference rather than re-summed over every card
  // for every snapshot, which is quadratic in a collection's history.
  let value = 0;
  let ungraded = 0;
  let priced = 0;
  for (const s of sorted) {
    if (!qty.has(s.cardId)) continue; // card has been deleted
    const q = qty.get(s.cardId)!;
    const before = current.get(s.cardId) ?? { value: 0, ungraded: 0 };
    const after = {
      value: (s.summary.yourCopyValue ?? 0) * q,
      ungraded: (s.summary.ungraded ?? 0) * q,
    };
    current.set(s.cardId, after);
    value += after.value - before.value;
    ungraded += after.ungraded - before.ungraded;
    if (before.value > 0) priced--;
    if (after.value > 0) priced++;
    const point = { t: s.fetchedAt, value: round2(value), ungraded: round2(ungraded), priced };
    // Snapshots taken in the same second (e.g. "refresh all") collapse into one point.
    const prev = points.at(-1);
    if (prev && prev.t === point.t) points[points.length - 1] = point;
    else points.push(point);
  }
  // A refresh that found the same prices adds no snapshot; it marks the
  // latest one as checked. Without this the line would stop at the last
  // change rather than reach the last time the prices were confirmed.
  const last = points.at(-1);
  let checked: string | null = null;
  for (const s of snapshots) if (s.checkedAt && qty.has(s.cardId) && (!checked || s.checkedAt > checked)) checked = s.checkedAt;
  if (last && checked && checked > last.t) points.push({ ...last, t: checked });
  return points;
}

export type Range = "1W" | "1M" | "3M" | "1Y" | "ALL";
export const RANGES: Range[] = ["1W", "1M", "3M", "1Y", "ALL"];

const RANGE_MS: Record<Exclude<Range, "ALL">, number> = {
  "1W": 7 * 864e5,
  "1M": 30 * 864e5,
  "3M": 91 * 864e5,
  "1Y": 365 * 864e5,
};

/** Slice a series to a range, keeping the last point before the window so the line has a start value. */
export function sliceRange<T extends { t: string }>(points: T[], range: Range, now = Date.now()): T[] {
  if (range === "ALL" || points.length === 0) return points;
  const from = now - RANGE_MS[range];
  const idx = points.findIndex((p) => new Date(p.t).getTime() >= from);
  if (idx === -1) return points.slice(-1);
  return points.slice(Math.max(0, idx - 1));
}

/** How finely a range is plotted: one reading per hour, day or week. */
export type Bucket = "hour" | "day" | "week";

const BUCKET_MS: Record<Bucket, number> = { hour: 36e5, day: 864e5, week: 7 * 864e5 };

/**
 * Keep one reading per bucket, the last one in it, like a daily close.
 * Refreshing a whole collection writes a snapshot per card seconds apart, and
 * plotting each of them draws a staircase climbing through the refresh rather
 * than the day's move; a close per bucket is the shape a stock chart has.
 * Buckets are cut at UTC hours, days and weeks.
 */
export function bucketSeries<T extends { t: string }>(points: readonly T[], bucket: Bucket): T[] {
  const out: T[] = [];
  let current: number | null = null;
  for (const p of points) {
    const key = Math.floor(new Date(p.t).getTime() / BUCKET_MS[bucket]);
    if (key === current && out.length) out[out.length - 1] = p;
    else {
      out.push(p);
      current = key;
    }
  }
  return out;
}

/** The bucket a range is read at; ALL follows how much history there is. */
export function bucketFor(range: Range, points: ReadonlyArray<{ t: string }> = []): Bucket {
  if (range === "1W") return "hour";
  if (range === "1M" || range === "3M") return "day";
  if (range === "1Y") return "week";
  const first = points[0];
  const last = points.at(-1);
  const span = first && last ? new Date(last.t).getTime() - new Date(first.t).getTime() : 0;
  if (span <= 14 * 864e5) return "hour";
  if (span <= 183 * 864e5) return "day";
  return "week";
}

/**
 * The points a range button shows: the window, read at that range's bucket.
 *
 * A collection that is new has no days to close: everything in it was recorded
 * in an afternoon, and one close for the day would leave a single dot with
 * nothing to be measured from. When the range's bucket leaves fewer than two
 * points the window is read at the next finer one, down to the points as
 * recorded, so the chart shows the history there is.
 */
export function rangeSeries<T extends { t: string }>(points: T[], range: Range, now = Date.now()): T[] {
  const window = sliceRange(points, range, now);
  const buckets: Bucket[] = ["week", "day", "hour"];
  for (const bucket of buckets.slice(buckets.indexOf(bucketFor(range, window)))) {
    const closes = bucketSeries(window, bucket);
    if (closes.length >= 2 || window.length < 2) return closes;
  }
  return window;
}

export interface Change {
  amount: number;
  percent: number | null;
  from: string | null;
}

export interface Performance extends Change {
  /** Value of copies that joined (+) or left (−) the collection over the window, at the prices they were carried at. */
  flows: number;
  /** amount − flows: what the collection made or lost because prices moved. */
  move: number;
  /** Return on the move alone, or null when there is nothing to divide by. */
  movePercent: number | null;
}

/** The fields a window is measured over: two points on the value line. A point with no `flows` has none. */
type Measurable = { t: string; value: number; flows?: number };

/**
 * A window's change, split the way a brokerage splits an account: cards coming
 * in and going out on one side, the market on the other. Buying a card lifts the
 * line without the collection having earned anything, so the percentage of the
 * move is taken over the value held through the window plus half the flows (the
 * simple Dietz return, which is what a fund reports when money moves in and out
 * mid-period). `percent` stays the plain change over the opening value.
 */
export function performance(first: Measurable | undefined, last: Measurable | undefined): Performance {
  if (!first || !last) return { amount: 0, percent: null, from: null, flows: 0, move: 0, movePercent: null };
  const amount = round2(last.value - first.value);
  const flows = round2((last.flows ?? 0) - (first.flows ?? 0));
  const move = round2(amount - flows);
  const base = first.value + flows / 2;
  return {
    amount,
    percent: first.value > 0 ? round2((amount / first.value) * 100) : null,
    from: first.t,
    flows,
    move,
    movePercent: base > 0 ? round2((move / base) * 100) : null,
  };
}

export function change(points: Array<{ t: string; value: number }>): Change {
  // One point has no earlier one to be measured from.
  const { amount, percent, from } = performance(points[0], points.length > 1 ? points.at(-1) : undefined);
  return { amount, percent, from };
}

// ---------------------------------------------------------------------------
// The recorded value of the collection: holdings, cost and flows
// ---------------------------------------------------------------------------

/** A point on the recorded history: its totals, plus what the copies cost and what moved in. */
export interface TimelinePoint extends PortfolioPoint {
  unpriced: number;
  copies: number;
  cost: number;
  costedValue: number;
  flows: number;
}

/** Kill the floating-point dust left by adding and subtracting card values. */
const clean = (n: number): number => (Math.abs(n) < 0.005 ? 0 : round2(n));

/**
 * The recorded holdings history with what a brokerage chart adds to it: the
 * copies held, what they cost, and a running total of the value that arrived
 * without any price moving.
 *
 * The totals are the ones `holdingsHistory` keeps, from the same record, so the
 * two never disagree about what the collection was worth. Each step of the
 * record changes one card, and its change in value is split in two. Copies
 * bought or sold at the price they were carried at, and a card priced for the
 * first time, are flow: the collection is bigger and nothing it held got dearer.
 * The copies already held being re-priced is the market.
 *
 * Cost is the card's average recorded cost per copy times the copies held then,
 * counting no more copies than ever had a cost recorded, and only while the card
 * has a price, so that cost and value are compared over the same copies. It is
 * today's recorded cost applied to the copies held back then: a lot edited
 * since reads back as if it had always been so.
 */
export function valueTimeline(
  ledger: { startedAt: string; events: readonly HoldingsEvent[] },
  rateOf: (cardId: number) => CostRate | undefined,
): TimelinePoint[] {
  interface Held { qty: number; unit: number | null; raw: number; cost: number; costed: number }
  const none: Held = { qty: 0, unit: null, raw: 0, cost: 0, costed: 0 };
  const held = new Map<number, Held>();
  const total = { value: 0, ungraded: 0, priced: 0, unpriced: 0, copies: 0, cost: 0, costedValue: 0, flows: 0 };
  const totals = (): TimelinePoint => ({
    t: "",
    value: clean(total.value),
    ungraded: clean(total.ungraded),
    priced: total.priced,
    unpriced: total.unpriced,
    copies: total.copies,
    cost: clean(total.cost),
    costedValue: clean(total.costedValue),
    flows: clean(total.flows),
  });
  const points: TimelinePoint[] = [{ ...totals(), t: ledger.startedAt }];
  for (const e of ledger.events) {
    const before = held.get(e.entityId) ?? none;
    const rate = rateOf(e.entityId);
    // Copies counted in the cost: none while the card has no price, so a card
    // awaiting its first price does not read as a loss.
    const counted = rate && e.unitValue !== null ? Math.min(e.quantity, rate.copies) : 0;
    const after: Held = {
      qty: e.quantity,
      unit: e.unitValue,
      raw: e.rawUnitValue ?? 0,
      cost: rate ? counted * rate.unitCost : 0,
      costed: e.unitValue !== null ? counted * e.unitValue : 0,
    };
    const u0 = before.unit ?? 0;
    const u1 = after.unit ?? 0;
    // A card with a price that is carried on is repriced (market) on the copies
    // it already had, and the change in copies is flow; a card with no price
    // before it has no market to move, so everything that arrives is flow.
    total.flows += u0 > 0 ? (after.qty - before.qty) * u1 : after.qty * u1 - before.qty * u0;
    total.value += after.qty * u1 - before.qty * u0;
    total.ungraded += after.qty * after.raw - before.qty * before.raw;
    total.copies += after.qty - before.qty;
    total.cost += after.cost - before.cost;
    total.costedValue += after.costed - before.costed;
    total.priced += (after.qty > 0 && after.unit !== null ? 1 : 0) - (before.qty > 0 && before.unit !== null ? 1 : 0);
    total.unpriced += (after.qty > 0 && after.unit === null ? 1 : 0) - (before.qty > 0 && before.unit === null ? 1 : 0);
    held.set(e.entityId, after);
    const point = { ...totals(), t: e.recordedAt };
    // Steps recorded in the same instant (an import, a refresh of every card) are one point.
    if (points.at(-1)?.t === point.t) points[points.length - 1] = point;
    else points.push(point);
  }
  return points;
}

// ---------------------------------------------------------------------------
// Grading outlook for ungraded cards
// ---------------------------------------------------------------------------

export interface Outlook {
  /** What the owner's raw copy is worth today (condition-adjusted). */
  raw: number;
  /** Realistic low outcome after grading (a mid grade). */
  min: number;
  minLabel: string;
  /** Best realistic outcome after grading (gem mint). */
  max: number;
  maxLabel: string;
  fee: number;
  /** max − raw − fee: what grading could add at best. */
  upside: number;
  /** min − raw − fee: what grading adds if it comes back a mid grade (negative = you lose money). */
  downside: number;
  /** Whether both bounds have recorded graded prices rather than multiplier estimates. */
  fromRealData: boolean;
  /** Provenance of each bound; a measured high end never makes the low end measured. */
  provenance?: { min: "observed" | "estimated"; max: "observed" | "estimated"; likely: "observed" | "estimated" | null; source: string | null; fetchedAt: string;
    minSource: string | null; maxSource: string | null; minAt: string; maxAt: string;
    likelySource: string | null; likelyAt: string | null;
    /** The centering limit that held the best case under a 10, when one did. */
    centeringCap: CenteringCap | null };
  /** Value at the grade the photo suggests this copy would receive, when one was estimated. */
  likely: number | null;
  likelyLabel: string | null;
}

const MAX_KEYS = ["PSA 10", "BGS 10", "CGC 10", "SGC 10", "TAG 10"];
const MIN_KEYS = ["PSA 8", "Grade 8", "CGC 8", "BGS 8", "PSA 7", "Grade 7"];

function pick(summary: PriceSummary, keys: string[]): { value: number; label: string; real: boolean } | null {
  for (const k of keys) if (summary.graded[k]) return { value: summary.graded[k], label: k, real: true };
  for (const k of keys) if (summary.estimatedGraded[k]) return { value: summary.estimatedGraded[k], label: k, real: false };
  return null;
}

/** Price at a specific expected grade, from real data first then the multiplier estimates. */
function atGrade(summary: PriceSummary, grade: string | null | undefined): { value: number; label: string; real: boolean } | null {
  const g = (grade ?? "").trim().replace(/[^0-9.]/g, "");
  if (!g) return null;
  const keys = [`PSA ${g}`, `Grade ${g}`, `CGC ${g}`, `BGS ${g}`, `SGC ${g}`, `TAG ${g}`];
  for (const key of keys) {
    if (summary.graded[key]) return { value: summary.graded[key], label: key, real: true };
  }
  for (const key of keys) {
    if (summary.estimatedGraded[key]) return { value: summary.estimatedGraded[key], label: key, real: false };
  }
  return null;
}

/** The number a grade label carries: "PSA 9.5" is 9.5, "Grade 8" is 8. */
function gradeNumber(label: string): number {
  const numbers = label.match(/\d+(?:\.\d+)?/g);
  return numbers ? Number(numbers[numbers.length - 1]) : NaN;
}

/** The company whose limits a best-case label is judged by; the generic grades follow PSA's. */
function companyOf(label: string): string {
  const word = label.split(" ")[0] ?? "";
  return word === "Grade" ? "PSA" : word;
}

/** The best priced grade at or under a cap, stepping down by half grades. */
function bestAtOrBelow(summary: PriceSummary, grade: number): { value: number; label: string; real: boolean } | null {
  for (let g = grade; g >= 1; g -= 0.5) {
    const hit = atGrade(summary, String(g));
    if (hit) return hit;
  }
  return null;
}

/**
 * Outlook from one snapshot; null when the card has no usable ungraded price.
 *
 * A measured centering caps the best case: a card whose borders are further
 * off than the company allows for a 10 is priced at the best grade its
 * centering leaves open, and the grade the photo suggests is held there too.
 * Nothing measured, or nothing on the front, leaves the outlook as it was.
 */
export function gradingOutlook(summary: PriceSummary, settings: Settings, expectedGrade?: string | null, centering?: Centering | null, game?: Game | null): Outlook | null {
  const raw = summary.yourCopyValue ?? summary.ungraded;
  if (!raw) return null;
  const best = pick(summary, MAX_KEYS);
  if (!best) return null;
  const min = pick(summary, MIN_KEYS) ?? { value: raw, label: "Ungraded", real: false };
  const fee = settings.gradingFee;
  const cap = centering ? highestGradeAllowed(companyOf(best.label), centering, game) : null;
  const capped = cap !== null && cap.grade < gradeNumber(best.label);
  // Nothing priced at or under the cap: the best case is the mid case.
  const max = capped ? (bestAtOrBelow(summary, cap.grade) ?? { value: min.value, label: min.label, real: min.real }) : best;
  let likelyGrade = expectedGrade ?? null;
  if (capped && likelyGrade) {
    const n = Number(String(likelyGrade).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > cap.grade) likelyGrade = String(cap.grade);
  }
  const likely = atGrade(summary, likelyGrade);
  const provenanceOf = (label: string, value: number) => {
    const priority = ["manual", "pricecharting", "pokemontcg", "scryfall", "ygoprodeck"];
    const quote = summary.quotes.filter(q => q.currency === "USD" && q.graded[label] === value)
      .sort((a, b) => priority.indexOf(a.source) - priority.indexOf(b.source))[0];
    return { source: quote?.sourceLabel ?? summary.gradedSource, at: quote?.fetchedAt ?? summary.fetchedAt };
  };
  const minProvenance = provenanceOf(min.label, min.value), maxProvenance = provenanceOf(max.label, max.value);
  const likelyMeasured = likely && summary.graded[likely.label] !== undefined;
  const likelyProvenance = likelyMeasured ? provenanceOf(likely.label, likely.value) : null;
  return {
    likely: likely?.value ?? null,
    likelyLabel: likely?.label ?? null,
    raw,
    min: min.value,
    minLabel: min.label,
    max: max.value,
    maxLabel: max.label,
    fee,
    upside: round2(max.value - raw - fee),
    downside: round2(min.value - raw - fee),
    fromRealData: max.real && min.real,
    provenance: { min: min.real ? "observed" : "estimated", max: max.real ? "observed" : "estimated",
      likely: likely ? (likelyMeasured ? "observed" : "estimated") : null,
      source: summary.gradedSource, fetchedAt: summary.fetchedAt,
      minSource: min.real ? minProvenance.source : null, maxSource: max.real ? maxProvenance.source : null,
      minAt: minProvenance.at, maxAt: maxProvenance.at,
      likelySource: likelyProvenance?.source ?? null, likelyAt: likelyProvenance?.at ?? null,
      centeringCap: capped ? cap : null },
  };
}

export interface OutlookPoint extends Outlook {
  t: string;
}

/**
 * How many of a card's newest snapshots the outlook is drawn from. The verdict
 * reads the last point and the peak within the series; three months of daily
 * checks is what "recent peak" means to a person, and it keeps the dashboard
 * from loading a card's whole life for a chart forty pixels high.
 */
export const OUTLOOK_SNAPSHOTS = 90;

/** How many outlook charts the dashboard draws before asking; the rest are one click away. */
export const OUTLOOK_SHOWN = 12;

/**
 * How many points of a card's outlook travel to the browser. The verdict is
 * decided on the server from the whole series; the chart is forty pixels
 * high, and ninety points a card for a few hundred cards was most of the page.
 */
export const OUTLOOK_POINTS = 30;

/** The series as the chart is sent it: thinned, with its first and last points kept. */
export function outlookForChart(series: OutlookPoint[]): OutlookPoint[] {
  return thinPoints(series, OUTLOOK_POINTS);
}

/** The charts to draw now, and how many the reader would have to ask for. */
export function capOutlook<T>(list: T[], showAll: boolean, limit = OUTLOOK_SHOWN): { shown: T[]; hidden: number } {
  if (showAll || list.length <= limit) return { shown: list, hidden: 0 };
  return { shown: list.slice(0, limit), hidden: list.length - limit };
}

export function outlookSeries(snapshots: PriceSnapshot[], settings: Settings, expectedGrade?: string | null, centering?: Centering | null, game?: Game | null): OutlookPoint[] {
  return [...snapshots]
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id)
    .flatMap((s) => {
      const o = gradingOutlook(s.summary, settings, expectedGrade, centering, game);
      return o ? [{ t: s.fetchedAt, ...o }] : [];
    });
}

export type VerdictKind = "prime" | "wait" | "skip" | "insufficient";

export interface Verdict {
  kind: VerdictKind;
  headline: string;
  detail: string;
  /** Current upside as a fraction of the best upside seen in the series (0–1). */
  upsideVsPeak: number | null;
}

/**
 * Heuristic on when to send a raw card in. "Prime" means the gap between the
 * gem-mint price and the raw price is at or near the widest it has been and
 * comfortably clears the grading fee; "wait" means the gap is narrower than it
 * was; "skip" means even a gem-mint result would not pay for the fee.
 */
export function gradingVerdict(series: OutlookPoint[]): Verdict {
  const last = series[series.length - 1];
  if (!last) return { kind: "insufficient", headline: "No price data", detail: "Refresh prices to see a grading outlook.", upsideVsPeak: null };
  if (last.upside <= 0) {
    return {
      kind: "skip",
      headline: "Not worth grading right now",
      detail: `Even a ${last.maxLabel} would return ${fmt(last.max)} against ${fmt(last.raw)} raw plus a ${fmt(last.fee)} fee.`,
      upsideVsPeak: null,
    };
  }
  const days = new Map<string, OutlookPoint>();
  for (const point of series) days.set(point.t.slice(0, 10), point);
  const daily = [...days.values()];
  if (daily.length < 3) {
    return {
      kind: "insufficient",
      headline: `Up to ${fmt(last.upside)} upside`,
      detail: "This comparison needs prices from at least three different days. Repeated refreshes today do not add another day of history.",
      upsideVsPeak: null,
    };
  }
  const [, peak] = extent(daily.map((p) => p.upside));
  const ratio = peak > 0 ? last.upside / peak : 0;
  const trend = last.upside - (daily[Math.max(0, daily.length - 4)] ?? last).upside;
  if (ratio >= 0.9) {
    return {
      kind: "prime",
      headline: "Near the best recorded premium",
      detail: `The ${last.maxLabel} premium over raw is ${fmt(last.upside)} after fees, ${ratio >= 0.999 ? "the widest" : "close to the widest"} recorded here.${trend > 0 ? " Still widening." : ""} This comparison does not predict the grade or a sale price.`,
      upsideVsPeak: ratio,
    };
  }
  return {
    kind: "wait",
    headline: "Gap has narrowed",
    detail: `Upside is ${fmt(last.upside)} now versus ${fmt(peak)} at its widest recorded here. ${trend > 0 ? "The recorded gap has increased recently." : "The recorded gap is below its earlier peak."}`,
    upsideVsPeak: ratio,
  };
}

/** Whether the latest outlook clears the owner's "ready to grade" thresholds and timing looks right. */
export function isReadyToGrade(series: OutlookPoint[], verdict: Verdict, settings: Settings): boolean {
  const last = series[series.length - 1];
  if (!last || verdict.kind !== "prime") return false;
  if (last.upside < settings.readyMinUpside) return false;
  return last.raw <= 0 || (last.upside / last.raw) * 100 >= settings.readyMinUpsidePercent;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

// ---------------------------------------------------------------------------
// Cost basis and return
// ---------------------------------------------------------------------------

export interface Returns {
  /** Sum of purchase price × quantity over cards with a recorded purchase price. */
  invested: number;
  /** Current value of those same cards. */
  valueOfInvested: number;
  amount: number;
  percent: number | null;
  /** How many cards have a purchase price recorded and a price to value them at. */
  cardsWithCost: number;
  /** Cards bought for a known price that have no current price yet, left out of both sides. */
  cardsAwaitingPrice: number;
  /** Copies whose cost was never recorded, left out of both sides. */
  copiesWithoutCost: number;
}

/**
 * Total return over the cards that can be judged: both what was paid and what
 * they are worth now have to be known.
 *
 * Cost comes from the purchase lots rather than a single price on the card,
 * and only the copies whose cost is recorded are counted — on both sides of the
 * ratio, so it compares like with like. Copies that arrived without a price
 * (a bulk lot, a gift, an old shoebox) are counted separately rather than
 * valued at nothing, which would read as pure profit.
 */
export function totalReturn(
  cards: CardRecord[],
  valueOf: (card: CardRecord) => number | null,
  basisOf: (card: CardRecord) => CostBasis | undefined,
): Returns {
  let invested = 0;
  let valueOfInvested = 0;
  let cardsWithCost = 0;
  let cardsAwaitingPrice = 0;
  let copiesWithoutCost = 0;
  for (const c of cards) {
    const basis = basisOf(c);
    if (!basis) continue;
    copiesWithoutCost += basis.copiesWithoutCost;
    if (basis.copiesWithCost === 0) continue;
    const value = valueOf(c);
    if (value === null) {
      cardsAwaitingPrice++;
      continue;
    }
    cardsWithCost++;
    invested += basis.invested;
    valueOfInvested += value * basis.copiesWithCost;
  }
  const amount = round2(valueOfInvested - invested);
  return {
    invested: round2(invested),
    valueOfInvested: round2(valueOfInvested),
    amount,
    percent: invested > 0 ? round2((amount / invested) * 100) : null,
    cardsWithCost,
    cardsAwaitingPrice,
    copiesWithoutCost,
  };
}

export interface Realized {
  /** Sale price × quantity, summed. */
  proceeds: number;
  fees: number;
  /** Cost basis of the copies sold, where it was recorded. */
  cost: number;
  /** proceeds − fees − cost. */
  gain: number;
  percent: number | null;
  sales: number;
  copies: number;
  /** Sales with unknown costs excluded; reported gain may overstate actual profit. */
  withoutCost: number;
}

/** Money actually banked: proceeds less fees less what those copies cost. */
export function realizedReturn(sales: Array<{ quantity: number; unitPrice: number; fees: number; unitCost: number | null }>): Realized {
  let proceeds = 0;
  let fees = 0;
  let cost = 0;
  let copies = 0;
  let withoutCost = 0;
  for (const s of sales) {
    proceeds += s.unitPrice * s.quantity;
    fees += s.fees;
    copies += s.quantity;
    if (s.unitCost === null) withoutCost++;
    else cost += s.unitCost * s.quantity;
  }
  const gain = proceeds - fees - cost;
  return {
    proceeds: round2(proceeds),
    fees: round2(fees),
    cost: round2(cost),
    gain: round2(gain),
    percent: cost > 0 ? round2((gain / cost) * 100) : null,
    sales: sales.length,
    copies,
    withoutCost,
  };
}

export interface SubmissionOutcome {
  cards: number;
  /** Grading fees plus shipping. */
  cost: number;
  /** Raw value of the cards when they went in. */
  rawValue: number;
  /** Value at the grades that came back, for the cards graded so far. */
  returnedValue: number;
  /** Best case at the time of sending, for a batch still out. */
  expectedValue: number;
  graded: number;
  /** returnedValue − rawValue − cost, once grades are in. */
  gain: number | null;
}

/** What a grading submission actually earned, or stands to earn while it is out. */
export function submissionOutcome(sub: {
  feePerCard: number;
  shipping: number;
  status: string;
  cards: Array<{ rawValue: number | null; expectedValue: number | null; returnedValue: number | null; returnedGrade: string | null }>;
}): SubmissionOutcome {
  const cards = sub.cards.length;
  const cost = round2(sub.feePerCard * cards + sub.shipping);
  let rawValue = 0;
  let returnedValue = 0;
  let expectedValue = 0;
  let graded = 0;
  let returnedRaw = 0;
  for (const c of sub.cards) {
    rawValue += c.rawValue ?? 0;
    expectedValue += c.expectedValue ?? c.rawValue ?? 0;
    if (c.returnedGrade) {
      graded++;
      returnedValue += c.returnedValue ?? c.rawValue ?? 0;
      returnedRaw += c.rawValue ?? 0;
    }
  }
  // Only the cards that have come back can be judged yet, so weigh them
  // against their own raw value and their share of the batch's cost. Once
  // every card is back this is the whole batch, as it should be.
  const share = cards > 0 ? graded / cards : 0;
  const costSoFar = graded === cards ? cost : round2(sub.feePerCard * graded + sub.shipping * share);
  return {
    cards,
    cost,
    rawValue: round2(rawValue),
    returnedValue: round2(returnedValue),
    expectedValue: round2(expectedValue),
    graded,
    gain: graded > 0 ? round2(returnedValue - returnedRaw - costSoFar) : null,
  };
}

export interface Allocation {
  game: CardRecord["game"];
  value: number;
  cards: number;
  share: number;
}

/** Value split by game, largest first. */
export function allocationByGame(cards: CardRecord[], valueOf: (card: CardRecord) => number | null): Allocation[] {
  const byGame = new Map<CardRecord["game"], { value: number; cards: number }>();
  let total = 0;
  for (const c of cards) {
    const v = (valueOf(c) ?? 0) * c.quantity;
    total += v;
    const cur = byGame.get(c.game) ?? { value: 0, cards: 0 };
    cur.value += v;
    cur.cards++;
    byGame.set(c.game, cur);
  }
  return [...byGame.entries()]
    .map(([game, { value, cards }]) => ({ game, value: round2(value), cards, share: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}
