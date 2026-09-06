import { refreshAll } from "./pricing/refresh";

const globalForScheduler = globalThis as unknown as { __collectcollectScheduler?: NodeJS.Timeout };

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
