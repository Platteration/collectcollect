import { addSnapshot, getCard, latestSnapshot, latestSnapshotsByCard, listCards, listSnapshots, updateCard } from "../cards";
import { alertsForRefresh, createAlert, deliver } from "../alerts";
import { getSettings } from "../settings";
import type { CardRecord, PriceSnapshot, PriceSummary } from "../types";
import { learnFromQuotes, priceCard } from "./index";
import { createGate } from "@collectcollect/core/gate";

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
export async function refreshCard(card: CardRecord): Promise<{ card: CardRecord; snapshot: PriceSnapshot; stored: boolean }> {
  const settings = getSettings();
  const history = listSnapshots(card.id, 200);
  const previous = history[0]?.summary ?? null;
  const summary = await priceCard(card, settings);
  const failed = !hasPrice(summary) && latestSnapshot(card.id) !== null;
  const snapshot: PriceSnapshot = failed
    ? { id: 0, cardId: card.id, fetchedAt: summary.fetchedAt, summary }
    : addSnapshot(card.id, summary);
  const learned = learnFromQuotes(summary.quotes);
  const patch: Record<string, unknown> = {};
  if (Object.keys(learned.externalIds).length) patch.externalIds = { ...card.externalIds, ...learned.externalIds };
  if (!card.referenceImageUrl && learned.referenceImageUrl) patch.referenceImageUrl = learned.referenceImageUrl;
  const updated = Object.keys(patch).length ? (updateCard(card.id, patch) ?? card) : card;

  if (!failed) {
    // History is newest-first from listSnapshots; alertsForRefresh wants it oldest-first.
    const ordered = [...history].reverse();
    for (const a of alertsForRefresh(updated, previous, summary, ordered, settings)) {
      void deliver(createAlert(a), settings);
    }
  }
  return { card: updated, snapshot, stored: !failed };
}

export interface RefreshResult {
  refreshed: number;
  /** Lookups that returned no prices (errors from every source); nothing stored for these. */
  unpriced: number;
  skipped: number;
  failed: Array<{ cardId: number; message: string }>;
}

/** When each card was last attempted, so cards that yield no price are retried on the normal cadence, not every tick. */
const lastAttempt = new Map<number, number>();

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
  return gate.busy;
}

/**
 * Refresh every card (or only those neither refreshed nor attempted within
 * `staleHours`). Runs a couple at a time to stay polite to the free APIs.
 */
export function refreshAll(opts: { staleHours?: number; concurrency?: number } = {}): Promise<RefreshResult> {
  return gate.run(() => refreshEverything(opts));
}

async function refreshEverything(opts: { staleHours?: number; concurrency?: number }): Promise<RefreshResult> {
  const { staleHours, concurrency = 2 } = opts;
  const latest = latestSnapshotsByCard();
  const cutoff = staleHours === undefined ? null : Date.now() - staleHours * 3600e3;
  const queue = listCards().filter((c) => {
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
        if (!fresh) continue;
        const r = await refreshCard(fresh);
        if (r.stored) result.refreshed++;
        else result.unpriced++;
      } catch (e) {
        result.failed.push({ cardId: card.id, message: e instanceof Error ? e.message : String(e) });
      }
    }
  });
  await Promise.all(workers);
  return result;
}
