import { addSnapshot, getItem, latestSnapshot, latestSnapshotsByItem, listItems, listSnapshots } from "../items";
import { alertsForRefresh, alertsForTradeLocks, createAlert, deliver } from "../alerts";
import { getSettings } from "../settings";
import type { ItemRecord, PriceSnapshot, PriceSummary } from "../types";
import { primeProviders, priceItem } from "./index";
import { createGate } from "@collectcollect/core/gate";

function hasPrice(summary: PriceSummary): boolean {
  return summary.yourCopyValue !== null || summary.market !== null;
}

/**
 * Price one item and store the result.
 *
 * A lookup that produced no price at all — every source down, or simply nobody
 * listing one — is returned so the page can explain, but it is not written over
 * an existing snapshot. A market being quiet for an afternoon must not erase an
 * item's last known value from the history.
 */
export async function refreshItem(
  item: ItemRecord,
  fetchImpl?: typeof fetch,
): Promise<{ item: ItemRecord; snapshot: PriceSnapshot; stored: boolean }> {
  const settings = getSettings();
  const previous = listSnapshots(item.id, 1)[0]?.summary ?? null;
  const summary = await priceItem(item, fetchImpl);
  const failed = !hasPrice(summary) && latestSnapshot(item.id) !== null;
  const snapshot: PriceSnapshot = failed
    ? { id: 0, itemId: item.id, fetchedAt: summary.fetchedAt, summary }
    : addSnapshot(item.id, summary);

  if (!failed) {
    for (const alert of alertsForRefresh(item, previous, summary, settings)) {
      void deliver(createAlert(alert), settings);
    }
  }
  return { item, snapshot, stored: !failed };
}

export interface RefreshResult {
  refreshed: number;
  /** Lookups that returned no price at all; nothing was stored for these. */
  unpriced: number;
  skipped: number;
  failed: Array<{ itemId: number; message: string }>;
  /** Catalogues that would not load, so those sources had nothing to say. */
  providerErrors: Array<{ source: string; message: string }>;
}

/** When each item was last attempted, so an item nothing prices is retried on the normal cadence rather than every tick. */
const lastAttempt = new Map<number, number>();

/**
 * Forget every attempt. Item ids restart with each test database, so a test
 * that did not clear this would inherit another test's throttling.
 */
export function resetRefreshThrottle(): void {
  lastAttempt.clear();
}

/**
 * One whole-inventory refresh at a time, across the scheduler and every button
 * press. A second one is refused with a BusyError rather than queued: the
 * answer it would produce is the one already under way. Kept on globalThis so
 * a reloaded module in development still sees the pass that is running.
 */
const globalForRefresh = globalThis as unknown as { __skinsRefreshGate?: ReturnType<typeof createGate> };
const gate = (globalForRefresh.__skinsRefreshGate ??= createGate("A price refresh is already running; wait for it to finish."));

/** Whether a whole-inventory refresh is running right now. */
export function refreshRunning(): boolean {
  return gate.busy;
}

/**
 * Refresh the whole inventory, or only what has gone stale.
 *
 * Catalogues load once, before anything else runs. That is the whole reason for
 * the priming step: without it, four hundred items would each ask Skinport for
 * the same catalogue, and Steam's per-item limit would be the only thing
 * setting the pace.
 *
 * Items are then done one at a time rather than in parallel. The card app runs
 * a couple at once because its sources are independent; here the slowest source
 * is rate limited across the whole process, so extra concurrency buys nothing
 * and only makes it harder to say what is happening.
 */
export function refreshAll(opts: { staleHours?: number; fetchImpl?: typeof fetch } = {}): Promise<RefreshResult> {
  return gate.run(() => refreshEverything(opts));
}

async function refreshEverything(opts: { staleHours?: number; fetchImpl?: typeof fetch }): Promise<RefreshResult> {
  const { staleHours, fetchImpl } = opts;
  const all = listItems();
  const latest = latestSnapshotsByItem();
  const cutoff = staleHours === undefined ? null : Date.now() - staleHours * 3600e3;
  const queue = all.filter((item) => {
    if (cutoff === null) return true;
    const snapshot = latest.get(item.id);
    const lastStored = snapshot ? new Date(snapshot.fetchedAt).getTime() : 0;
    return Math.max(lastStored, lastAttempt.get(item.id) ?? 0) < cutoff;
  });

  const result: RefreshResult = {
    refreshed: 0,
    unpriced: 0,
    skipped: all.length - queue.length,
    failed: [],
    providerErrors: await primeProviders(fetchImpl),
  };

  for (const queued of queue) {
    lastAttempt.set(queued.id, Date.now());
    try {
      const fresh = getItem(queued.id);
      if (!fresh) continue;
      const outcome = await refreshItem(fresh, fetchImpl);
      if (outcome.stored) result.refreshed++;
      else result.unpriced++;
    } catch (e) {
      result.failed.push({ itemId: queued.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // A lock ending changes nothing about an item, so nothing else would notice.
  const settings = getSettings();
  for (const alert of alertsForTradeLocks(all)) void deliver(createAlert(alert), settings);

  return result;
}
