import type { CostBasis } from "./acquisitions";
import { round2 } from "../pricing/match";

/**
 * The portfolio maths, with no opinion about what is being valued: a series
 * of totals over time, a range slice, the change over it, what was paid
 * against what it is worth, what selling actually banked, and a split of
 * value by whatever the caller groups on.
 */

export interface PortfolioPoint {
  t: string;
  /** Sum of yourCopyValue × quantity using the latest snapshot per item at this time. */
  value: number;
  /** Items that had a price at this point. */
  priced: number;
}

interface Countable {
  id: number;
  quantity: number;
}

interface Snapshotish {
  id: number;
  itemId: number;
  fetchedAt: string;
  summary: { yourCopyValue: number | null };
}

/**
 * A step series of total value. Each snapshot changes one item's
 * contribution; totals are recomputed at every snapshot time using the most
 * recent snapshot of every item. Quantities are taken from the items as they
 * are now (there is no quantity history).
 */
export function portfolioSeries(items: Countable[], snapshots: Snapshotish[]): PortfolioPoint[] {
  const qty = new Map(items.map((i) => [i.id, i.quantity]));
  const current = new Map<number, number>();
  const points: PortfolioPoint[] = [];
  const sorted = [...snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.id - b.id);
  for (const s of sorted) {
    if (!qty.has(s.itemId)) continue;
    current.set(s.itemId, (s.summary.yourCopyValue ?? 0) * qty.get(s.itemId)!);
    let value = 0;
    let priced = 0;
    for (const v of current.values()) {
      value += v;
      if (v > 0) priced++;
    }
    const point = { t: s.fetchedAt, value: round2(value), priced };
    // Snapshots taken in the same second (a "refresh all") collapse into one point.
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

export interface Returns {
  invested: number;
  valueOfInvested: number;
  amount: number;
  percent: number | null;
  itemsWithCost: number;
  itemsAwaitingPrice: number;
  copiesWithoutCost: number;
}

/**
 * Total return over the items that can be judged: both what was paid and what
 * they are worth now have to be known, and only the copies whose cost is
 * recorded are counted, on both sides of the ratio.
 */
export function totalReturn<T extends { id: number }>(
  items: T[],
  valueOf: (item: T) => number | null,
  basisOf: (item: T) => CostBasis | undefined,
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
  proceeds: number;
  fees: number;
  cost: number;
  gain: number;
  percent: number | null;
  sales: number;
  copies: number;
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

export interface AllocationRow {
  key: string;
  value: number;
  items: number;
  share: number;
}

export interface Split {
  rows: AllocationRow[];
  unclassified: number;
  unclassifiedShare: number;
}

/**
 * Value split by whatever you group on, largest first. An item the grouping
 * has no answer for gets no row, but its value still counts towards the total
 * the shares are measured against, and what is unaccounted for is reported.
 */
export function allocationBy<T extends { quantity: number }>(
  items: T[],
  keyOf: (item: T) => string | null,
  valueOf: (item: T) => number | null,
): Split {
  const groups = new Map<string, { value: number; items: number }>();
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
