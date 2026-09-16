import { addSnapshot, getCard, latestSnapshot, latestSnapshotsByCard, listCards, listSnapshots, updateCard } from "../cards";
import { alertsForRefresh, createAlert, deliver } from "../alerts";
import { getSettings } from "../settings";
import type { CardRecord, PriceSnapshot, PriceSummary } from "../types";
import { learnFromQuotes, priceCard } from "./index";
import { createGate } from "@collectcollect/core/gate";
import { BusyError } from "@collectcollect/core/gate";
import type { JobRefreshOptions } from "@collectcollect/core/price-jobs";
import { archiveGate } from "../storage";

const refreshState = globalThis as unknown as { __cardsActivePrices?: number };

function hasPrice(s: PriceSummary): boolean {
  return Boolean(s.ungraded || s.yourCopyValue || Object.keys(s.graded).length);
}

/**
 * Fetch prices for one card, store the snapshot, and remember any provider ids
 * learned. A lookup that produced no price at all (sources down, no source for
 * this game, or no match) is returned so the UI can explain, but it is not
 * stored over an existing snapshot: a network blip or a missing API key must
 * not erase a card's last known value from the portfolio history.
 */
export async function refreshCard(card: CardRecord): Promise<{ card: CardRecord; snapshot: PriceSnapshot; stored: boolean; skipped?: boolean }> {
  if (archiveGate.busy) throw new BusyError("A backup or restore is in progress.");
  refreshState.__cardsActivePrices = (refreshState.__cardsActivePrices ?? 0) + 1;
  try {
    const settings = getSettings();
    const history = listSnapshots(card.id, 200);
    const previous = history[0]?.summary ?? null;
    const summary = await priceCard(card, settings);
    const current = getCard(card.id);
    if (!current || current.quantity <= 0) return { card, snapshot: { id: 0, cardId: card.id, fetchedAt: summary.fetchedAt, summary }, stored: false, skipped: true };
    const failed = !hasPrice(summary) && latestSnapshot(card.id) !== null;
    const snapshot: PriceSnapshot = failed
      ? { id: 0, cardId: card.id, fetchedAt: summary.fetchedAt, summary }
      : addSnapshot(card.id, summary);
    const learned = learnFromQuotes(summary.quotes);
    const patch: Record<string, unknown> = {};
    if (Object.keys(learned.externalIds).length) patch.externalIds = { ...learned.externalIds, ...current.externalIds };
    if (!current.referenceImageUrl && learned.referenceImageUrl) patch.referenceImageUrl = learned.referenceImageUrl;
    const updated = Object.keys(patch).length ? (updateCard(card.id, patch) ?? current) : current;

    if (!failed) {
      // History is newest-first from listSnapshots; alertsForRefresh wants it oldest-first.
      const ordered = [...history].reverse();
      for (const a of alertsForRefresh(updated, previous, summary, ordered, settings)) {
        void deliver(createAlert(a), settings);
      }
    }
    return { card: updated, snapshot, stored: !failed };
  } finally { refreshState.__cardsActivePrices = Math.max(0, (refreshState.__cardsActivePrices ?? 1) - 1); }
}

export interface RefreshResult {
  refreshed: number;
  /** Lookups that returned no prices (errors from every source); nothing stored for these. */
  unpriced: number;
  skipped: number;
  failed: Array<{ cardId: number; message: string }>;
}

/** When each card was last attempted, so cards that yield no price are retried on the normal cadence, not every tick. */
const globalForAttempts = globalThis as unknown as { __collectcollectLastAttempt?: Map<number, number> };
// On the global object, so a development reload does not forget what was
// tried a minute ago and try it all again.
const lastAttempt: Map<number, number> = (globalForAttempts.__collectcollectLastAttempt ??= new Map());

/** Forget every attempt. Card ids restart with each test database, so a test
 * that did not clear this would inherit another test's throttling. */
export function resetRefreshThrottle(): void {
  lastAttempt.clear();
}

/**
 * One whole-collection refresh at a time, across the scheduler and every
 * button press. A second one is refused with a BusyError rather than queued:
 * the answer it would produce is the one already under way. Kept on globalThis
 * so a reloaded module in development still sees the pass that is running.
 */
const globalForRefresh = globalThis as unknown as { __collectcollectRefreshGate?: ReturnType<typeof createGate> };
const gate = (globalForRefresh.__collectcollectRefreshGate ??= createGate("A price refresh is already running; wait for it to finish."));

/** Whether a whole-collection refresh is running right now. */
export function refreshRunning(): boolean {
  return gate.busy || (refreshState.__cardsActivePrices ?? 0) > 0;
}

/**
 * Refresh every card (or only those neither refreshed nor attempted within
 * `staleHours`). Runs a couple at a time to stay polite to the free APIs.
 */
export function refreshAll(opts: { staleHours?: number; concurrency?: number } & JobRefreshOptions = {}): Promise<RefreshResult> {
  if (archiveGate.busy) return Promise.reject(new BusyError("A backup or restore is in progress."));
  return gate.run(() => refreshEverything(opts));
}

async function refreshEverything(opts: { staleHours?: number; concurrency?: number } & JobRefreshOptions): Promise<RefreshResult> {
  const { staleHours } = opts;
  const concurrency = Math.max(1, Math.min(8, Math.floor(opts.concurrency ?? 2) || 2));
  const latest = latestSnapshotsByCard();
  const cutoff = staleHours === undefined ? null : Date.now() - staleHours * 3600e3;
  const queue = listCards().filter((c) => {
    if (opts.ids && !opts.ids.includes(c.id)) return false;
    if (cutoff === null) return true;
    const snap = latest.get(c.id);
    const lastStored = snap ? new Date(snap.fetchedAt).getTime() : 0;
    const lastTried = Math.max(lastStored, lastAttempt.get(c.id) ?? 0);
    return lastTried < cutoff;
  });
  const result: RefreshResult = { refreshed: 0, unpriced: 0, skipped: listCards().length - queue.length, failed: [] };
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const card = queue.shift()!;
      lastAttempt.set(card.id, Date.now());
      try {
        const fresh = getCard(card.id);
        if (!fresh || fresh.quantity <= 0) { result.skipped++; opts.onProgress?.({ id: card.id, status: "skipped", message: "Card was removed or sold out." }); continue; }
        const r = await refreshCard(fresh);
        if (r.skipped) { result.skipped++; opts.onProgress?.({ id: card.id, status: "skipped", message: "Card was removed or sold out during refresh." }); continue; }
        const priced = hasPrice(r.snapshot.summary);
        if (r.stored) result.refreshed++;
        else result.unpriced++;
        opts.onProgress?.({ id: card.id, status: priced ? "priced" : r.snapshot.summary.errors.length ? "failed" : "unpriced",
          message: r.snapshot.summary.errors.map(e => `${e.source}: ${e.message}`).join("; ") || (priced ? undefined : "No matching price found; previous value kept.") });
      } catch (e) {
        result.failed.push({ cardId: card.id, message: e instanceof Error ? e.message : String(e) });
        opts.onProgress?.({ id: card.id, status: "failed", message: e instanceof Error ? e.message : String(e) });
      }
    }
  });
  await Promise.all(workers);
  return result;
}
