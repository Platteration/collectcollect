import { refreshAll, type RefreshResult } from "./pricing/refresh";
import { sweepOrphanedUploads } from "./uploads";

const globalForScheduler = globalThis as unknown as {
  __collectcollectScheduler?: NodeJS.Timeout;
  __collectcollectSweeper?: NodeJS.Timeout;
};

/**
 * Keep price history flowing without the user having to click refresh: once
 * an hour, re-price any card whose latest snapshot is older than
 * AUTO_REFRESH_HOURS (default 24; 0 disables). Started from instrumentation.ts.
 */
export function startPriceScheduler(): void {
  const hours = Number(process.env.AUTO_REFRESH_HOURS ?? "24");
  if (!Number.isFinite(hours) || hours <= 0) return;
  if (globalForScheduler.__collectcollectScheduler) return;

  const tick = () => priceTick(hours);
  // First pass shortly after boot, then hourly.
  setTimeout(tick, 60_000).unref();
  globalForScheduler.__collectcollectScheduler = setInterval(tick, 3600_000);
  globalForScheduler.__collectcollectScheduler.unref();
}

/**
 * One automatic pass. refreshAll never throws for a card: a lookup that
 * errors is collected into `failed` and one that found no price counts as
 * `unpriced`, so the returned result is the only place either is ever seen,
 * and a pass that is not reported is a card whose price history stops with
 * nothing in the log to say so. The catch below fires only when the pass
 * itself could not run (the database refused to list the cards).
 */
export async function priceTick(hours: number): Promise<void> {
  try {
    const r = await refreshAll({ staleHours: hours });
    if (r.failed.length || r.unpriced) console.warn(describeRefresh(r));
  } catch (e) {
    console.error("[prices] auto-refresh failed", e);
  }
}

function describeRefresh(r: RefreshResult): string {
  const failures = r.failed.map((f) => `card ${f.cardId}: ${f.message}`).join("; ");
  return (
    `[prices] auto-refresh: ${r.refreshed} refreshed, ${r.unpriced} returned no prices, ${r.skipped} fresh, ` +
    `${r.failed.length} failed${failures ? ` (${failures})` : ""}`
  );
}

/**
 * Reclaim photos no card points at: the back and slab-label shots, the scans
 * that ended in review, the re-taken frames. Daily is often enough — the files
 * have to be a day old to qualify — and it runs whether or not automatic
 * re-pricing is on, because the disk fills either way.
 */
export function startUploadSweeper(): void {
  if (globalForScheduler.__collectcollectSweeper) return;

  // Not at boot: a restore may still be holding the database.
  setTimeout(sweepTick, 5 * 60_000).unref();
  globalForScheduler.__collectcollectSweeper = setInterval(sweepTick, 24 * 3600_000);
  globalForScheduler.__collectcollectSweeper.unref();
}

/**
 * One sweep. It deletes files from the owner's data directory, so what it
 * removed is said in the log rather than only in the free space: the sweeper
 * swallows an unlink that races a write and reports the count it did manage.
 */
export async function sweepTick(): Promise<void> {
  try {
    const { removed, bytes } = await sweepOrphanedUploads();
    if (removed) console.warn(`[uploads] removed ${removed} photo${removed === 1 ? "" : "s"} no card points at (${Math.round(bytes / 1024)} KB)`);
  } catch (e) {
    console.error("[uploads] sweep failed", e);
  }
}
