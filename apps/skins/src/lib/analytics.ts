import type { CostBasis } from "./acquisitions";
import type { ItemRecord, PriceSnapshot } from "./types";

/** Money, to the cent. Doing this once stops rounding drift showing up in totals. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Inventory value over time
// ---------------------------------------------------------------------------

export interface PortfolioPoint {
  /** ISO timestamp */
  t: string;
  /** Sum of yourCopyValue × quantity using the latest snapshot per item at this time. */
  value: number;
  /** Items that had a price at this point. */
  priced: number;
}

/**
 * Build a step series of total inventory value. Each snapshot changes one
 * item's contribution; totals are recomputed at every snapshot time using the
 * most recent snapshot of every item. Quantities are taken from the items as
 * they are now (there is no quantity history).
 */
export function portfolioSeries(items: ItemRecord[], snapshots: PriceSnapshot[]): PortfolioPoint[] {
  const qty = new Map(items.map((i) => [i.id, i.quantity]));
  const current = new Map<number, number>();
  const points: PortfolioPoint[] = [];
  const sorted = [...snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id);
  for (const s of sorted) {
    if (!qty.has(s.itemId)) continue; // item has been deleted
    current.set(s.itemId, (s.summary.yourCopyValue ?? 0) * qty.get(s.itemId)!);
    let value = 0;
    let priced = 0;
    for (const v of current.values()) {
      value += v;
      if (v > 0) priced++;
    }
    const point = { t: s.fetchedAt, value: round2(value), priced };
    // Snapshots taken in the same second (a "refresh all") collapse into one point.
    const last = points[points.length - 1];
    if (last && last.t === point.t) points[points.length - 1] = point;
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
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 2 || !first || !last) return { amount: 0, percent: null, from: null };
  const amount = round2(last.value - first.value);
  return { amount, percent: first.value > 0 ? round2((amount / first.value) * 100) : null, from: first.t };
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

export interface Returns {
  /** What was paid for the copies still held, over the lots whose cost is known. */
  invested: number;
  /** Current value of those same copies. */
  valueOfInvested: number;
  amount: number;
  percent: number | null;
  /** How many items have a cost recorded and a price to value them at. */
  itemsWithCost: number;
  /** Items bought for a known price that have no current price yet, left out of both sides. */
  itemsAwaitingPrice: number;
  /** Copies whose cost was never recorded, left out of both sides. */
  copiesWithoutCost: number;
}

/**
 * Total return over the items that can be judged: both what was paid and what
 * they are worth now have to be known.
 *
 * Cost comes from the purchase lots, and only the copies whose cost is recorded
 * are counted — on both sides of the ratio, so it compares like with like.
 * Copies that arrived without a price (opened from a case, traded for, a gift)
 * are counted separately rather than valued at nothing, which would read as
 * pure profit.
 */
export function totalReturn(
  items: ItemRecord[],
  valueOf: (item: ItemRecord) => number | null,
  basisOf: (item: ItemRecord) => CostBasis | undefined,
): Returns {
  let invested = 0;
  let valueOfInvested = 0;
  let itemsWithCost = 0;
  let itemsAwaitingPrice = 0;
  let copiesWithoutCost = 0;
  for (const i of items) {
    const basis = basisOf(i);
    if (!basis) continue;
    copiesWithoutCost += basis.copiesWithoutCost;
    if (basis.copiesWithCost === 0) continue;
    const value = valueOf(i);
    if (value === null) {
      itemsAwaitingPrice++;
      continue;
    }
    itemsWithCost++;
    invested += basis.invested;
    valueOfInvested += value * basis.copiesWithCost;
  }
  const amount = round2(valueOfInvested - invested);
  return {
    invested: round2(invested),
    valueOfInvested: round2(valueOfInvested),
    amount,
    percent: invested > 0 ? round2((amount / invested) * 100) : null,
    itemsWithCost,
    itemsAwaitingPrice,
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
export function realizedReturn(
  sales: Array<{ quantity: number; unitPrice: number; fees: number; unitCost: number | null }>,
): Realized {
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

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

export interface Allocation<K> {
  key: K;
  value: number;
  items: number;
  share: number;
}

export interface Split<K> {
  rows: Array<Allocation<K>>;
  /** Value held by items this grouping has no answer for. */
  unclassified: number;
  unclassifiedShare: number;
}

/**
 * Value split by whatever you group on, largest first. A CS2 inventory is worth
 * slicing several ways — by kind of item, by rarity, by collection — so the
 * grouping is the caller's to choose rather than baked in.
 *
 * An item the grouping has no answer for (a case belongs to no collection) gets
 * no row, rather than being filed under a made-up "Other" that would claim it
 * was classified. But its value still counts towards the total the shares are
 * measured against, so the bars do not silently rescale to fill the chart: what
 * they leave unaccounted for is reported instead, and the caller can say so.
 */
export function allocationBy<K>(
  items: ItemRecord[],
  keyOf: (item: ItemRecord) => K | null,
  valueOf: (item: ItemRecord) => number | null,
): Split<K> {
  const groups = new Map<K, { value: number; items: number }>();
  let total = 0;
  let unclassified = 0;
  for (const i of items) {
    const v = (valueOf(i) ?? 0) * i.quantity;
    total += v;
    const key = keyOf(i);
    if (key === null) {
      unclassified += v;
      continue;
    }
    const cur = groups.get(key) ?? { value: 0, items: 0 };
    cur.value += v;
    cur.items++;
    groups.set(key, cur);
  }
  return {
    rows: [...groups.entries()]
      .map(([key, g]) => ({ key, value: round2(g.value), items: g.items, share: total > 0 ? g.value / total : 0 }))
      .sort((a, b) => b.value - a.value),
    unclassified: round2(unclassified),
    unclassifiedShare: total > 0 ? unclassified / total : 0,
  };
}
