import { refreshAll } from "./pricing/refresh";
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

  const tick = async () => {
    try {
      const r = await refreshAll({ staleHours: hours });
      if (r.refreshed || r.unpriced || r.failed.length) {
        console.log(`[prices] auto-refresh: ${r.refreshed} refreshed, ${r.unpriced} returned no prices, ${r.skipped} fresh, ${r.failed.length} failed`);
      }
    } catch (e) {
      console.error("[prices] auto-refresh failed", e);
    }
  };
  // First pass shortly after boot, then hourly.
  setTimeout(tick, 60_000).unref();
  globalForScheduler.__collectcollectScheduler = setInterval(tick, 3600_000);
  globalForScheduler.__collectcollectScheduler.unref();
}

/**
 * Reclaim photos no card points at: the back and slab-label shots, the scans
 * that ended in review, the re-taken frames. Daily is often enough — the files
 * have to be a day old to qualify — and it runs whether or not automatic
 * re-pricing is on, because the disk fills either way.
 */
export function startUploadSweeper(): void {
  if (globalForScheduler.__collectcollectSweeper) return;

  const sweep = async () => {
    try {
      const { removed, bytes } = await sweepOrphanedUploads();
      if (removed) console.log(`[uploads] removed ${removed} photo${removed === 1 ? "" : "s"} no card points at (${Math.round(bytes / 1024)} KB)`);
    } catch (e) {
      console.error("[uploads] sweep failed", e);
    }
  };
  // Not at boot: a restore may still be holding the database.
  setTimeout(sweep, 5 * 60_000).unref();
  globalForScheduler.__collectcollectSweeper = setInterval(sweep, 24 * 3600_000);
  globalForScheduler.__collectcollectSweeper.unref();
}
