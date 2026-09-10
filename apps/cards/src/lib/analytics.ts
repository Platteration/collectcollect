import type { CostBasis } from "./acquisitions";
import type { CardRecord, PriceSnapshot } from "./types";
import { round2 } from "./pricing/match";

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
}

/**
 * Build a step series of total collection value. Each snapshot changes one
 * card's contribution; totals are recomputed at every snapshot time using the
 * most recent snapshot of every card. Quantities are taken from the cards as
 * they are now (there is no quantity history).
 */
export function portfolioSeries(cards: CardRecord[], snapshots: PriceSnapshot[]): PortfolioPoint[] {
  const qty = new Map(cards.map((c) => [c.id, c.quantity]));
  const current = new Map<number, { value: number; ungraded: number }>();
  const points: PortfolioPoint[] = [];
  const sorted = [...snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id);
  for (const s of sorted) {
    if (!qty.has(s.cardId)) continue; // card has been deleted
    const q = qty.get(s.cardId)!;
    current.set(s.cardId, {
      value: (s.summary.yourCopyValue ?? 0) * q,
      ungraded: (s.summary.ungraded ?? 0) * q,
    });
    let value = 0;
    let ungraded = 0;
    let priced = 0;
    for (const v of current.values()) {
      value += v.value;
      ungraded += v.ungraded;
      if (v.value > 0) priced++;
    }
    const point = { t: s.fetchedAt, value: round2(value), ungraded: round2(ungraded), priced };
    // Snapshots taken in the same second (e.g. "refresh all") collapse into one point.
    if (points.length && points[points.length - 1].t === point.t) points[points.length - 1] = point;
    else points.push(point);
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

export interface Change {
  amount: number;
  percent: number | null;
  from: string | null;
}

export function change(points: Array<{ t: string; value: number }>): Change {
  if (points.length < 2) return { amount: 0, percent: null, from: null };
  const first = points[0];
  const last = points[points.length - 1];
  const amount = round2(last.value - first.value);
  return { amount, percent: first.value > 0 ? round2((amount / first.value) * 100) : null, from: first.t };
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
