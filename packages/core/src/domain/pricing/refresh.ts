import type { Alerts } from "../alerts";
import { priceMoveAlert } from "../alerts";
import type { Repository } from "../repository";
import type { SettingsStore } from "../settings";
import type { DomainSpec, ItemRecord, PriceSnapshot, PriceSummary } from "../spec";
import { fetchQuotes, learnFromQuotes, primeProviders } from "./index";
import { num } from "../normalize";

export interface RefreshResult {
  refreshed: number;
  /** Lookups that returned no price at all; nothing stored for these. */
  unpriced: number;
  skipped: number;
  failed: Array<{ itemId: number; message: string }>;
  /** Catalogues that would not load, so those sources had nothing to say. */
  providerErrors: Array<{ source: string; message: string }>;
}

export type Refresh<F extends object, X extends object> = ReturnType<typeof createRefresh<F, object, X, unknown>>;

export function createRefresh<F extends object, S extends object, X extends object, Q>(ctx: {
  spec: DomainSpec<F, S, X, Q>;
  repo: Repository<F, X>;
  settings: SettingsStore<S>;
  alerts: Alerts;
}) {
  const { spec, repo, settings, alerts } = ctx;
  const providers = spec.pricing.providers;

  function hasPrice(summary: PriceSummary<X>): boolean {
    return summary.yourCopyValue !== null || summary.quotes.some((q) => q.price !== null || Object.keys(q.prices).length > 0);
  }

  async function priceItem(item: ItemRecord<F>, fetchImpl?: typeof fetch): Promise<PriceSummary<X>> {
    const { quotes, errors } = await fetchQuotes(providers, spec.pricing.query(item), fetchImpl);
    return spec.pricing.summarize({ item, quotes, errors, settings: settings.getSettings(), fetchedAt: new Date().toISOString() });
  }

  /**
   * Price one item and store the result. A lookup that produced no price at
   * all is returned so the page can explain, but it is not written over an
   * existing snapshot: a source being down for an afternoon must not erase an
   * item's last known value from the history.
   */
  async function refreshItem(item: ItemRecord<F>, fetchImpl?: typeof fetch): Promise<{ item: ItemRecord<F>; snapshot: PriceSnapshot<X>; stored: boolean }> {
    const current = settings.getSettings();
    const history = repo.listSnapshots(item.id, 200);
    const previous = history[0]?.summary ?? null;
    const summary = await priceItem(item, fetchImpl);
    const failed = !hasPrice(summary) && repo.latestSnapshot(item.id) !== null;
    const snapshot: PriceSnapshot<X> = failed ? { id: 0, itemId: item.id, fetchedAt: summary.fetchedAt, summary } : repo.addSnapshot(item.id, summary);

    const learned = learnFromQuotes(summary.quotes);
    const patch: Record<string, unknown> = {};
    if (Object.keys(learned.externalIds).length) patch.externalIds = { ...item.externalIds, ...learned.externalIds };
    if (!item.referenceImageUrl && learned.referenceImageUrl) patch.referenceImageUrl = learned.referenceImageUrl;
    const updated = Object.keys(patch).length ? (repo.updateItem(item.id, patch as Partial<ItemRecord<F>>) ?? item) : item;

    if (!failed) {
      const ordered = [...history].reverse();
      const out = [];
      const move = priceMoveAlert(updated, spec.title(updated), previous, summary, current);
      if (move) out.push(move);
      if (spec.alerts?.forRefresh) out.push(...spec.alerts.forRefresh({ item: updated, previous, next: summary, history: ordered, settings: current }));
      for (const a of out) void alerts.deliver(alerts.createAlert(a), current);
    }
    return { item: updated, snapshot, stored: !failed };
  }

  /** When each item was last attempted, so one nothing prices is retried on the normal cadence, not every tick. */
  const lastAttempt = new Map<number, number>();

  function resetRefreshThrottle(): void {
    lastAttempt.clear();
  }

  async function refreshAll(opts: { staleHours?: number; fetchImpl?: typeof fetch; concurrency?: number } = {}): Promise<RefreshResult> {
    const { staleHours, fetchImpl } = opts;
    const concurrency = Math.max(1, opts.concurrency ?? spec.pricing.concurrency ?? 2);
    const all = repo.listItems();
    const latest = repo.latestSnapshotsByItem();
    const cutoff = staleHours === undefined ? null : Date.now() - staleHours * 3600e3;
    const queue = all.filter((item) => {
      if (cutoff === null) return true;
      const snap = latest.get(item.id);
      const lastStored = snap ? new Date(snap.fetchedAt).getTime() : 0;
      return Math.max(lastStored, lastAttempt.get(item.id) ?? 0) < cutoff;
    });
    const result: RefreshResult = {
      refreshed: 0,
      unpriced: 0,
      skipped: all.length - queue.length,
      failed: [],
      providerErrors: await primeProviders(providers, fetchImpl),
    };
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const queued = queue.shift()!;
        lastAttempt.set(queued.id, Date.now());
        try {
          const fresh = repo.getItem(queued.id);
          if (!fresh) continue;
          const outcome = await refreshItem(fresh, fetchImpl);
          if (outcome.stored) result.refreshed++;
          else result.unpriced++;
        } catch (e) {
          result.failed.push({ itemId: queued.id, message: e instanceof Error ? e.message : String(e) });
        }
      }
    });
    await Promise.all(workers);
    return result;
  }

  /**
   * A price entered by hand as a point in the history, so a value chart works
   * for things no source prices: an auction result, an appraisal, a receipt.
   */
  function addManualSnapshot(itemId: number, input: { value: unknown; at?: unknown; note?: unknown }): PriceSnapshot<X> {
    const item = repo.getItem(itemId);
    if (!item) throw new Error("Item not found");
    const value = num(input.value);
    if (value === null || value < 0) throw new Error("A value has to be a number");
    const when = input.at ? new Date(String(input.at).length === 10 ? `${input.at}T12:00:00` : String(input.at)) : new Date();
    if (Number.isNaN(when.getTime())) throw new Error("That is not a valid date");
    const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : "Entered by hand";
    const base = {
      currency: "USD" as const,
      fetchedAt: when.toISOString(),
      yourCopyValue: Math.round(value * 100) / 100,
      yourCopyBasis: note,
      quotes: [],
      errors: [],
    };
    // The domain's own extras are filled in from its summariser with no
    // quotes, so the snapshot has the shape every page expects.
    const shaped = spec.pricing.summarize({ item, quotes: [], errors: [], settings: settings.getSettings(), fetchedAt: base.fetchedAt });
    return repo.addSnapshot(itemId, { ...shaped, ...base });
  }

  return { priceItem, refreshItem, refreshAll, resetRefreshThrottle, addManualSnapshot };
}
