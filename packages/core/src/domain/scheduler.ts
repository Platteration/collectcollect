import type { RefreshResult } from "./pricing/refresh";

/**
 * Keep the price history flowing without anyone pressing refresh: once an
 * hour, re-price whatever has not been priced within <PREFIX>_AUTO_REFRESH_HOURS
 * (default 24; 0 disables). Only one pass runs at a time.
 */
export function createScheduler(envPrefix: string, id: string, refreshAll: (opts: { staleHours: number }) => Promise<RefreshResult>) {
  const key = `__collectcollect_scheduler_${id.replace(/[^a-z0-9]/gi, "_")}`;
  const store = globalThis as unknown as Record<string, NodeJS.Timeout | undefined>;

  function start(): void {
    const hours = Number(process.env[`${envPrefix}_AUTO_REFRESH_HOURS`] ?? "24");
    if (!Number.isFinite(hours) || hours <= 0) return;
    if (store[key]) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const r = await refreshAll({ staleHours: hours });
        if (r.refreshed || r.unpriced || r.failed.length) {
          console.log(`[prices] auto-refresh: ${r.refreshed} priced, ${r.unpriced} returned no prices, ${r.skipped} fresh, ${r.failed.length} failed`);
        }
        for (const error of r.providerErrors) console.warn(`[prices] ${error.source}: ${error.message}`);
      } catch (e) {
        console.error("[prices] auto-refresh failed", e);
      } finally {
        running = false;
      }
    };
    setTimeout(tick, 60_000).unref();
    store[key] = setInterval(tick, 3600_000);
    store[key]!.unref();
  }

  return { start };
}
