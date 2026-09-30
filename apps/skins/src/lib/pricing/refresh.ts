import { addSnapshot, getItem, latestSnapshot, latestSnapshotsByItem, listItems, markChecked } from "../items";
import { alertsForRefresh, alertsForTradeLocks, createAlert, deliver, markLockAlerted } from "../alerts";
import { getSettings } from "../settings";
import type { ItemRecord, PriceSnapshot, PriceSummary } from "../types";
import { primeProviders, priceItem, sameSummary } from "./index";
import { createGate } from "@collectcollect/core/gate";
import { BusyError } from "@collectcollect/core/gate";
import type { JobRefreshOptions } from "@collectcollect/core/price-jobs";
import { archiveGate } from "../storage";

const refreshState = globalThis as unknown as { __skinsActivePrices?: number };

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
 *
 * A lookup that found exactly the prices the latest snapshot already holds is
 * not a new fact about the item either: that snapshot is marked as checked now
 * (`unchanged`) rather than copied, so an item refreshed every hour for a year
 * does not carry a year of identical rows. Nothing moved, so it raises nothing.
 */
export async function refreshItem(
  item: ItemRecord,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<{ item: ItemRecord; snapshot: PriceSnapshot; stored: boolean; skipped?: boolean; unchanged?: boolean }> {
  if (archiveGate.busy) throw new BusyError("A backup or restore is in progress.");
  refreshState.__skinsActivePrices = (refreshState.__skinsActivePrices ?? 0) + 1;
  try {
    const settings = getSettings();
    const summary = await priceItem(item, settings, fetchImpl, signal);
    const current = getItem(item.id);
    if (!current || current.quantity <= 0) return { item, snapshot: { id: 0, itemId: item.id, fetchedAt: summary.fetchedAt, summary }, stored: false, skipped: true };
    const latest = latestSnapshot(item.id);
    const previous = latest?.summary ?? null;
    // A lookup abandoned because the pass was told to stop is not an answer
    // about the item, so it is never written down, not even as a first one.
    const failed = !hasPrice(summary) && (latest !== null || signal?.aborted === true);
    if (!failed && latest && sameSummary(latest.summary, summary)) {
      markChecked(latest.id, summary.fetchedAt);
      return { item: current, snapshot: { ...latest, checkedAt: summary.fetchedAt }, stored: false, unchanged: true };
    }
    const snapshot: PriceSnapshot = failed
      ? { id: 0, itemId: item.id, fetchedAt: summary.fetchedAt, summary }
      : addSnapshot(item.id, summary);

    if (!failed) {
      for (const alert of alertsForRefresh(current, previous, summary, settings)) {
        void deliver(createAlert(alert), settings);
      }
    }
    return { item: current, snapshot, stored: !failed };
  } finally { refreshState.__skinsActivePrices = Math.max(0, (refreshState.__skinsActivePrices ?? 1) - 1); }
}

export interface RefreshResult {
  refreshed: number;
  /** Lookups that found the same prices as last time; the latest snapshot was marked as checked, and nothing stored. */
  unchanged: number;
  /** Lookups that returned no price at all; nothing was stored for these. */
  unpriced: number;
  skipped: number;
  failed: Array<{ itemId: number; message: string }>;
  /** Catalogues that would not load, so those sources had nothing to say. */
  providerErrors: Array<{ source: string; message: string }>;
  /** The pass was told to stop before it reached every item; the rest are counted as skipped. */
  cancelled?: boolean;
}

/** When each item was last attempted, so an item nothing prices is retried on the normal cadence rather than every tick. */
const globalForAttempts = globalThis as unknown as { __skinsLastAttempt?: Map<number, number> };
// On the global object, so a development reload does not forget what was
// tried a minute ago and try it all again.
const lastAttempt: Map<number, number> = (globalForAttempts.__skinsLastAttempt ??= new Map());

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
const globalForRefresh = globalThis as unknown as { __skinsRefreshGate?: ReturnType<typeof createGate>; __skinsRefreshAbort?: AbortController };
const gate = (globalForRefresh.__skinsRefreshGate ??= createGate("A price refresh is already running; wait for it to finish."));

/**
 * Tell the whole-inventory pass that is running to stop. It abandons the
 * request it is waiting on and returns with `cancelled` set; nothing it
 * stored is undone. A restore asks for this rather than being refused for
 * as long as four hundred items take.
 */
export function cancelRefresh(): void {
  globalForRefresh.__skinsRefreshAbort?.abort();
}

/** Wait for the whole-inventory pass to end, up to `withinMs`; true when it has. */
export async function refreshStopped(withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (gate.busy) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/**
 * Whether a whole-inventory refresh is running right now. Single-item lookups
 * are not counted: a save fires one of these in the background,
 * and the hourly pass runs unattended, so "something is pricing" would be
 * true for no visible reason most of the day. They are `activeLookups`.
 */
export function refreshRunning(): boolean {
  return gate.busy;
}

/** How many single-item lookups are in flight right now. */
export function activeLookups(): number {
  return refreshState.__skinsActivePrices ?? 0;
}

/**
 * Wait for the single-item lookups in flight to finish, up to `withinMs`;
 * true when they have. Meant to be called with the archive gate held: a lookup
 * checks that gate before it counts itself in, and nothing runs between the
 * check and the count, so once the gate is held the number can only fall.
 */
export async function lookupsSettled(withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (activeLookups() > 0) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
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
export function refreshAll(opts: { staleHours?: number; fetchImpl?: typeof fetch; signal?: AbortSignal } & JobRefreshOptions = {}): Promise<RefreshResult> {
  if (archiveGate.busy) return Promise.reject(new BusyError("A backup or restore is in progress."));
  return gate.run(() => {
    const controller = new AbortController();
    globalForRefresh.__skinsRefreshAbort = controller;
    const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
    return refreshEverything({ ...opts, signal }).finally(() => {
      if (globalForRefresh.__skinsRefreshAbort === controller) globalForRefresh.__skinsRefreshAbort = undefined;
    });
  });
}

async function refreshEverything(opts: { staleHours?: number; fetchImpl?: typeof fetch; signal?: AbortSignal } & JobRefreshOptions): Promise<RefreshResult> {
  const { staleHours, fetchImpl, signal } = opts;
  const all = listItems();
  const latest = latestSnapshotsByItem();
  const cutoff = staleHours === undefined ? null : Date.now() - staleHours * 3600e3;
  const queue = all.filter((item) => {
    if (opts.ids && !opts.ids.includes(item.id)) return false;
    if (cutoff === null) return true;
    const snapshot = latest.get(item.id);
    // A check that found the same prices counts as a refresh, or a stable item
    // would be asked about every hour of every day.
    const lastStored = snapshot ? new Date(snapshot.checkedAt ?? snapshot.fetchedAt).getTime() : 0;
    return Math.max(lastStored, lastAttempt.get(item.id) ?? 0) < cutoff;
  });

  const result: RefreshResult = {
    refreshed: 0,
    unchanged: 0,
    unpriced: 0,
    skipped: all.length - queue.length,
    failed: [],
    providerErrors: await primeProviders(fetchImpl, signal),
  };

  for (const [index, queued] of queue.entries()) {
    if (signal?.aborted) {
      // Told to stop: what is left is not failed, it was never asked about.
      result.cancelled = true;
      result.skipped += queue.length - index;
      break;
    }
    lastAttempt.set(queued.id, Date.now());
    try {
      const fresh = getItem(queued.id);
      if (!fresh || fresh.quantity <= 0) { result.skipped++; opts.onProgress?.({ id: queued.id, status: "skipped", message: "Item was removed or sold out." }); continue; }
      const outcome = await refreshItem(fresh, fetchImpl, signal);
      if (signal?.aborted && !outcome.stored && !outcome.unchanged) {
        // The request it was waiting on was abandoned; this item was not priced.
        result.cancelled = true;
        result.skipped += queue.length - index;
        break;
      }
      if (outcome.skipped) { result.skipped++; opts.onProgress?.({ id: queued.id, status: "skipped", message: "Item was removed or sold out during refresh." }); continue; }
      const priced = hasPrice(outcome.snapshot.summary);
      if (outcome.stored) result.refreshed++;
      else if (outcome.unchanged) result.unchanged++;
      else result.unpriced++;
      const errors = [...result.providerErrors, ...outcome.snapshot.summary.errors].map(e => `${e.source}: ${e.message}`).join("; ");
      opts.onProgress?.({ id: queued.id, status: priced ? "priced" : errors ? "failed" : "unpriced",
        message: outcome.unchanged ? `Unchanged since ${outcome.snapshot.fetchedAt.slice(0, 10)}.${errors ? ` ${errors}` : ""}` : errors || (priced ? undefined : "No listing found; previous value kept.") });
    } catch (e) {
      result.failed.push({ itemId: queued.id, message: e instanceof Error ? e.message : String(e) });
      opts.onProgress?.({ id: queued.id, status: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // A lock ending changes nothing about an item, so nothing else would notice.
  const settings = getSettings();
  for (const alert of alertsForTradeLocks(listItems())) {
    void deliver(createAlert(alert), settings);
    markLockAlerted(alert.itemId, alert.tradableAfter);
  }

  return result;
}
