import type { CardRecord, PriceSnapshot, PriceSummary, Settings } from "./types";
import { round2 } from "./pricing/match";

// ---------------------------------------------------------------------------
// Portfolio value over time
// ---------------------------------------------------------------------------

export interface PortfolioPoint {
  /** ISO timestamp */
  t: string;
  /** Sum of yourCopyValue × copies held at this time. */
  value: number;
  /** Sum of ungraded × copies held (what those copies would be worth raw NM). */
  ungraded: number;
  /** Cards that were held and had a price at this point. */
  priced: number;
  /** What the copies held here cost, over the cards with a purchase price recorded. */
  cost: number;
  /** Copies held at this point. */
  copies: number;
  /**
   * Running total of value that joined (or left) the collection rather than
   * being earned: a card catalogued and first priced counts in, copies sold
   * count out. The part of a move that is not flow is the market moving.
   */
  flows: number;
}

/** A sale as the timeline sees it: copies that left the collection on a date. */
export interface SaleEvent {
  cardId: number;
  quantity: number;
  soldAt: string;
}

interface Holding {
  qty: number;
  /** Purchase price per copy, or null when none was recorded. */
  cost: number | null;
  /** Latest known value of one copy, at the point being computed. */
  value: number;
  ungraded: number;
}

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** Kill the floating-point dust left by adding and subtracting card values. */
const clean = (n: number): number => (Math.abs(n) < 0.005 ? 0 : round2(n));

/**
 * Build the value of the collection over time, the way a brokerage plots an
 * account: at any instant the total covers the copies actually held then,
 * priced at the most recent snapshot of each card at that instant.
 *
 * Three kinds of event move the line: a price snapshot (a card is worth more or
 * less), a card being added (its copies join the total from the date it was
 * catalogued) and a sale (its copies leave on the day they sold, instead of
 * being erased from the whole history). Cards with no `createdAt` — and there
 * is no quantity history, so a card's copies are treated as held from the day
 * it was added — count from the start of the series.
 */
export function portfolioSeries(cards: CardRecord[], snapshots: PriceSnapshot[], sales: SaleEvent[] = []): PortfolioPoint[] {
  const held = new Map<number, Holding>();
  const total = { value: 0, ungraded: 0, cost: 0, copies: 0, priced: 0, flows: 0 };
  const events: Array<{ at: number; seq: number; t: string; run: () => void }> = [];
  const on = (t: string, run: () => void) => events.push({ at: time(t), seq: events.length, t, run });

  /** Change one card's holding and keep the running totals in step with it. */
  const edit = (id: number, mutate: (h: Holding) => void) => {
    const h = held.get(id);
    if (!h) return;
    const was = { qty: h.qty, value: h.value };
    total.value -= h.qty * h.value;
    total.ungraded -= h.qty * h.ungraded;
    total.cost -= h.qty * (h.cost ?? 0);
    total.copies -= h.qty;
    if (h.qty > 0 && h.value > 0) total.priced--;
    mutate(h);
    total.value += h.qty * h.value;
    total.ungraded += h.qty * h.ungraded;
    total.cost += h.qty * (h.cost ?? 0);
    total.copies += h.qty;
    if (h.qty > 0 && h.value > 0) total.priced++;
    // Value that arrives without any price having moved: a card priced for the
    // first time (it was in no total before, at any price), or copies joining
    // or leaving the collection at the price they were carried at.
    if (was.value === 0 && h.value > 0) total.flows += h.qty * h.value;
    else if (h.qty !== was.qty) total.flows += (h.qty - was.qty) * h.value;
  };

  const byCard = new Map<number, SaleEvent[]>();
  for (const s of sales) {
    if (s.quantity <= 0 || Number.isNaN(time(s.soldAt))) continue;
    const list = byCard.get(s.cardId);
    if (list) list.push(s);
    else byCard.set(s.cardId, [s]);
  }

  for (const c of cards) {
    const acquired = time(c.createdAt);
    const sold = byCard.get(c.id) ?? [];
    // Copies that have been sold were still owned before the sale, so the
    // collection starts out holding them. A sale dated at or before the card
    // was added never shows on the line; take those copies off up front.
    let owned = c.quantity + sold.reduce((n, s) => n + s.quantity, 0);
    for (const s of sold) if (!Number.isNaN(acquired) && time(s.soldAt) <= acquired) owned -= s.quantity;
    owned = Math.max(0, owned);
    held.set(c.id, { qty: Number.isNaN(acquired) ? owned : 0, cost: c.purchasePrice ?? null, value: 0, ungraded: 0 });
    if (!Number.isNaN(acquired)) {
      on(c.createdAt, () => edit(c.id, (h) => void (h.qty = owned)));
    } else {
      // No catalogue date to start from: count the copies for the whole series.
      total.cost += owned * (c.purchasePrice ?? 0);
      total.copies += owned;
    }
    for (const s of sold) {
      if (!Number.isNaN(acquired) && time(s.soldAt) <= acquired) continue;
      on(s.soldAt, () => edit(c.id, (h) => void (h.qty = Math.max(0, h.qty - s.quantity))));
    }
  }

  for (const s of [...snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id)) {
    if (!held.has(s.cardId)) continue; // card has been deleted
    on(s.fetchedAt, () =>
      edit(s.cardId, (h) => {
        h.value = s.summary.yourCopyValue ?? 0;
        h.ungraded = s.summary.ungraded ?? 0;
      }),
    );
  }

  events.sort((a, b) => a.at - b.at || a.seq - b.seq);
  const points: PortfolioPoint[] = [];
  for (let i = 0; i < events.length; i++) {
    events[i].run();
    // Everything at the same instant — a "refresh all" run, a sale on the day a
    // card was added — is one point on the line.
    if (i + 1 < events.length && events[i + 1].at === events[i].at) continue;
    // Nothing has a price yet: the line has no useful zero to start from.
    if (points.length === 0 && total.priced === 0) continue;
    points.push({
      t: events[i].t,
      value: clean(total.value),
      ungraded: clean(total.ungraded),
      priced: total.priced,
      cost: clean(total.cost),
      copies: total.copies,
      flows: clean(total.flows),
    });
  }
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
 * Keep one reading per bucket — the last one in it, like a daily close.
 * Refreshing a whole collection writes a snapshot per card seconds apart, and
 * plotting each of them draws a staircase climbing through the refresh rather
 * than the day's move; a close per bucket is the shape a stock chart has.
 */
export function bucketSeries<T extends { t: string }>(points: T[], bucket: Bucket): T[] {
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
export function bucketFor(range: Range, points: Array<{ t: string }> = []): Bucket {
  if (range === "1W") return "hour";
  if (range === "1M" || range === "3M") return "day";
  if (range === "1Y") return "week";
  const first = points[0];
  const last = points[points.length - 1];
  const span = first && last ? new Date(last.t).getTime() - new Date(first.t).getTime() : 0;
  if (span <= 14 * 864e5) return "hour";
  if (span <= 183 * 864e5) return "day";
  return "week";
}

/** The points a range button shows: the window, read at that range's bucket. */
export function rangeSeries<T extends { t: string }>(points: T[], range: Range, now = Date.now()): T[] {
  const window = sliceRange(points, range, now);
  return bucketSeries(window, bucketFor(range, window));
}

export interface Performance {
  /** Change in value from the start of the window to its end. */
  amount: number;
  /** amount as a percentage of the value at the start, where there was one. */
  percent: number | null;
  /** When the window starts. */
  from: string | null;
  /** Value of copies that joined (+) or left (−) the collection over the window. */
  flows: number;
  /** amount − flows: what the collection made or lost because prices moved. */
  move: number;
  /** Return on the move, ignoring the flows, or null when there is nothing to divide by. */
  movePercent: number | null;
}

/** The fields a window is measured over: two points on the value line. */
type Measurable = Pick<PortfolioPoint, "t" | "value" | "flows">;

/**
 * A window's change, split the way a brokerage splits an account: money (here,
 * cards) coming in and going out on one side, the market on the other. Buying a
 * card lifts the line without the collection having earned anything, so the
 * percentage is taken on the move alone, over the value held through the window
 * plus half the flows — the simple Dietz return, which is what a fund reports
 * when money moves in and out mid-period.
 */
export function performance(first: Measurable | undefined, last: Measurable | undefined): Performance {
  if (!first || !last || first === last) return { amount: 0, percent: null, from: null, flows: 0, move: 0, movePercent: null };
  const amount = round2(last.value - first.value);
  const flows = round2(last.flows - first.flows);
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
  /** Whether min/max came from real graded sales (true) or from the multiplier estimates. */
  fromRealData: boolean;
  /** Value at the grade the photo suggests this copy would receive, when one was estimated. */
  likely: number | null;
  likelyLabel: string | null;
}

const MAX_KEYS = ["PSA 10", "BGS 10", "CGC 10", "SGC 10"];
const MIN_KEYS = ["PSA 8", "Grade 8", "CGC 8", "BGS 8", "PSA 7", "Grade 7"];

function pick(summary: PriceSummary, keys: string[]): { value: number; label: string; real: boolean } | null {
  for (const k of keys) if (summary.graded[k]) return { value: summary.graded[k], label: k, real: true };
  for (const k of keys) if (summary.estimatedGraded[k]) return { value: summary.estimatedGraded[k], label: k, real: false };
  return null;
}

/** Price at a specific expected grade, from real data first then the multiplier estimates. */
function atGrade(summary: PriceSummary, grade: string | null | undefined): { value: number; label: string } | null {
  const g = (grade ?? "").trim().replace(/[^0-9.]/g, "");
  if (!g) return null;
  for (const key of [`PSA ${g}`, `Grade ${g}`, `CGC ${g}`, `BGS ${g}`]) {
    if (summary.graded[key]) return { value: summary.graded[key], label: key };
  }
  for (const key of [`PSA ${g}`, `Grade ${g}`, `CGC ${g}`, `BGS ${g}`]) {
    if (summary.estimatedGraded[key]) return { value: summary.estimatedGraded[key], label: key };
  }
  return null;
}

/** Outlook from one snapshot; null when the card has no usable ungraded price. */
export function gradingOutlook(summary: PriceSummary, settings: Settings, expectedGrade?: string | null): Outlook | null {
  const raw = summary.yourCopyValue ?? summary.ungraded;
  if (!raw) return null;
  const max = pick(summary, MAX_KEYS);
  if (!max) return null;
  const min = pick(summary, MIN_KEYS) ?? { value: raw, label: "Ungraded", real: false };
  const fee = settings.gradingFee;
  const likely = atGrade(summary, expectedGrade);
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
    fromRealData: max.real,
  };
}

export interface OutlookPoint extends Outlook {
  t: string;
}

export function outlookSeries(snapshots: PriceSnapshot[], settings: Settings, expectedGrade?: string | null): OutlookPoint[] {
  return [...snapshots]
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id)
    .flatMap((s) => {
      const o = gradingOutlook(s.summary, settings, expectedGrade);
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
  if (series.length < 3) {
    return {
      kind: "insufficient",
      headline: `Up to ${fmt(last.upside)} upside`,
      detail: "Not enough history yet to tell whether the gap is widening. Prices refresh daily; check back in a week.",
      upsideVsPeak: null,
    };
  }
  const peak = Math.max(...series.map((p) => p.upside));
  const ratio = peak > 0 ? last.upside / peak : 0;
  const trend = last.upside - series[Math.max(0, series.length - 4)].upside;
  if (ratio >= 0.9) {
    return {
      kind: "prime",
      headline: "Good time to grade",
      detail: `The ${last.maxLabel} premium over raw is ${fmt(last.upside)} after fees, ${ratio >= 0.999 ? "the widest" : "close to the widest"} it has been.${trend > 0 ? " Still widening." : ""}`,
      upsideVsPeak: ratio,
    };
  }
  return {
    kind: "wait",
    headline: "Gap has narrowed",
    detail: `Upside is ${fmt(last.upside)} now versus ${fmt(peak)} at its widest. ${trend > 0 ? "It is recovering." : "Consider waiting for the graded premium to come back."}`,
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
  /** How many cards have a purchase price recorded. */
  cardsWithCost: number;
}

/** Total return over the cards whose cost is known; cards without a purchase price are left out of both sides. */
export function totalReturn(cards: CardRecord[], valueOf: (card: CardRecord) => number | null): Returns {
  let invested = 0;
  let valueOfInvested = 0;
  let cardsWithCost = 0;
  for (const c of cards) {
    if (c.purchasePrice === null || c.purchasePrice < 0) continue;
    cardsWithCost++;
    invested += c.purchasePrice * c.quantity;
    valueOfInvested += (valueOf(c) ?? 0) * c.quantity;
  }
  const amount = round2(valueOfInvested - invested);
  return {
    invested: round2(invested),
    valueOfInvested: round2(valueOfInvested),
    amount,
    percent: invested > 0 ? round2((amount / invested) * 100) : null,
    cardsWithCost,
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
  /** How many sales had no cost basis, so the gain understates them. */
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
  for (const c of sub.cards) {
    rawValue += c.rawValue ?? 0;
    expectedValue += c.expectedValue ?? c.rawValue ?? 0;
    if (c.returnedGrade) {
      graded++;
      returnedValue += c.returnedValue ?? c.rawValue ?? 0;
    }
  }
  return {
    cards,
    cost,
    rawValue: round2(rawValue),
    returnedValue: round2(returnedValue),
    expectedValue: round2(expectedValue),
    graded,
    gain: graded > 0 ? round2(returnedValue - rawValue - cost) : null,
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
