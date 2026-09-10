import { refreshAll } from "./pricing/refresh";

const globalForScheduler = globalThis as unknown as { __skinsScheduler?: NodeJS.Timeout };

/**
 * Keep the price history flowing without anyone having to press refresh: once
 * an hour, re-price whatever has not been priced within
 * SKINS_AUTO_REFRESH_HOURS (default 24; 0 disables). Started from
 * instrumentation.ts.
 *
 * A large inventory takes a while — Steam answers about twenty times a minute —
 * and that is fine here, because this runs in the background and skips anything
 * already fresh. Only one tick runs at a time: a pass still working through a
 * four-hundred-item inventory must not have another started on top of it.
 */
export function startPriceScheduler(): void {
  const hours = Number(process.env.SKINS_AUTO_REFRESH_HOURS ?? "24");
  if (!Number.isFinite(hours) || hours <= 0) return;
  if (globalForScheduler.__skinsScheduler) return;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await refreshAll({ staleHours: hours });
      if (result.refreshed || result.unpriced || result.failed.length) {
        console.log(
          `[prices] auto-refresh: ${result.refreshed} priced, ${result.unpriced} nothing listing, ${result.skipped} still fresh, ${result.failed.length} failed`,
        );
      }
      for (const error of result.providerErrors) console.warn(`[prices] ${error.source}: ${error.message}`);
    } catch (e) {
      console.error("[prices] auto-refresh failed", e);
    } finally {
      running = false;
    }
  };

  // First pass shortly after boot, then hourly.
  setTimeout(tick, 60_000).unref();
  globalForScheduler.__skinsScheduler = setInterval(tick, 3600_000);
  globalForScheduler.__skinsScheduler.unref();
}
