import type { ItemRecord, PriceSnapshot } from "./types";

/**
 * What one copy of an item is worth right now, and where that number came from.
 *
 * A price typed in by hand always wins: it is the owner saying they know
 * better than the market feed, and quietly overriding them would be worse than
 * useless. Otherwise it is the last recorded value. There is deliberately no
 * third case — no estimate from a similar float, no guess from a neighbouring
 * wear tier — so an item nobody has priced reads as "not priced" rather than as
 * a number that looks measured and is not.
 */
export interface Valuation {
  value: number | null;
  basis: string;
}

export function valueOf(item: ItemRecord, snapshot: PriceSnapshot | undefined | null): Valuation {
  if (item.manualPrice !== null) return { value: item.manualPrice, basis: "Your own price" };
  const recorded = snapshot?.summary.yourCopyValue ?? null;
  if (recorded === null) return { value: null, basis: "Not priced yet" };
  return { value: recorded, basis: snapshot!.summary.yourCopyBasis || "Last recorded price" };
}

/** What the copies held of this item are worth together. */
export function holdingValue(item: ItemRecord, snapshot: PriceSnapshot | undefined | null): number | null {
  const { value } = valueOf(item, snapshot);
  return value === null ? null : value * item.quantity;
}
