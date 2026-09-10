import { latestSnapshotsByItem, listItems } from "./items";
import { proceedsByMarket, type MarketProceeds } from "./pricing/index";
import { getSettings } from "./settings";
import type { ItemRecord, Settings } from "./types";

/**
 * Where each item in the inventory is worth most, and by how much.
 *
 * The comparison is only ever between markets that pay money. Steam usually
 * shows the highest number in CS2 and its proceeds are wallet funds that cannot
 * be withdrawn, so a ranking that mixed the two would tell owners to sell where
 * they would not actually be paid.
 */

export interface SpreadRow {
  item: ItemRecord;
  /** Markets that pay money, best net first. */
  cash: MarketProceeds[];
  /** Steam, kept apart. */
  wallet: MarketProceeds[];
  /** Net difference per copy between the best and worst cash market. */
  gap: number;
  gapPercent: number;
  /** The gap across every copy held, which is what decides whether it is worth doing. */
  total: number;
  /** Whether it can actually be sold today. */
  locked: boolean;
  tradableAfter: string | null;
}

export interface SpreadView {
  /** Rows clearing the thresholds in Settings, biggest total first. */
  worthDoing: SpreadRow[];
  /** Rows with a comparison to make that did not clear them. */
  slim: SpreadRow[];
  /** Items only one market is listing, so there is nothing to compare. */
  noComparison: number;
  /** Items nothing has priced at all. */
  unpriced: number;
  /** Of the rows worth doing, those that cannot be acted on yet. */
  lockedCount: number;
  settings: Settings;
}

export function spreadView(settings = getSettings()): SpreadView {
  const latest = latestSnapshotsByItem();
  const now = new Date();
  const rows: SpreadRow[] = [];
  let noComparison = 0;
  let unpriced = 0;

  for (const item of listItems()) {
    if (item.quantity <= 0) continue;
    const summary = latest.get(item.id)?.summary;
    if (!summary) {
      unpriced++;
      continue;
    }
    const { cash, wallet } = proceedsByMarket(summary.quotes, settings);
    if (cash.length === 0 && wallet.length === 0) {
      unpriced++;
      continue;
    }
    if (cash.length < 2) {
      // One market listing an item is not a spread. Comparing it against
      // nothing, or against Steam, would invent one.
      noComparison++;
      continue;
    }
    const best = cash[0];
    const worst = cash[cash.length - 1];
    const gap = Math.round((best.net - worst.net) * 100) / 100;
    const locked = item.tradableAfter !== null && new Date(item.tradableAfter) > now;
    rows.push({
      item,
      cash,
      wallet,
      gap,
      gapPercent: worst.net > 0 ? (gap / worst.net) * 100 : 0,
      total: Math.round(gap * item.quantity * 100) / 100,
      locked,
      tradableAfter: item.tradableAfter,
    });
  }

  /**
   * The amount threshold is about whether a move is worth the effort, and
   * effort is per listing rather than per copy — nine cents each across
   * thirty-five cases is three dollars for one action. So it is measured
   * against the whole holding, while the percentage stays per copy, where it
   * means something.
   */
  const clears = (row: SpreadRow) => row.total >= settings.spreadMinAmount && row.gapPercent >= settings.spreadMinPercent;
  const biggestFirst = (a: SpreadRow, b: SpreadRow) => b.total - a.total;
  const worthDoing = rows.filter(clears).sort(biggestFirst);

  return {
    worthDoing,
    slim: rows.filter((r) => !clears(r)).sort(biggestFirst),
    noComparison,
    unpriced,
    lockedCount: worthDoing.filter((r) => r.locked).length,
    settings,
  };
}
