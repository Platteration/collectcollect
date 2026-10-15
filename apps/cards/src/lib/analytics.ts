import { extent, thinPoints } from "@collectcollect/core/series";
import type { CostBasis } from "./acquisitions";
import type { CardRecord, PriceSnapshot } from "./types";
import { round2 } from "./pricing/match";
import { highestGradeAllowed, type CenteringCap } from "./grading/centering";

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

// The outlook and the grade / wait / skip verdict live in the shared package
// now, so a sealed game or a raw comic reasons the same way. The card app's
// grade keys are the package's defaults, and these re-exports keep every
// import in this app and its tests where it was.
export {
  gradingOutlook,
  outlookSeries,
  gradingVerdict,
  isReadyToGrade,
  type Outlook,
  type OutlookPoint,
  type Verdict,
  type VerdictKind,
} from "@collectcollect/core/grading";

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
