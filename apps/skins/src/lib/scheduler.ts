import { BusyError } from "@collectcollect/core/gate";
import { logError } from "@collectcollect/core/http";
import { refreshAll, refreshRunning, type RefreshResult } from "./pricing/refresh";

export interface SchedulerStatus {
  /** Whether the hourly pass is switched on at all (SKINS_AUTO_REFRESH_HOURS > 0). */
  enabled: boolean;
  /** Items older than this many hours are re-priced. */
  staleHours: number;
  /** Whether a whole-inventory refresh is running right now, from any caller. */
  running: boolean;
  lastRunAt: string | null;
  lastResult: RefreshResult | null;
  lastError: string | null;
}

interface SchedulerState {
  timer: NodeJS.Timeout | null;
  status: SchedulerStatus;
}

// One per process: Next reloads server modules in development, and a second
// interval on top of the first would run every pass twice.
const globalForScheduler = globalThis as unknown as { __skinsScheduler?: SchedulerState };
const state: SchedulerState = (globalForScheduler.__skinsScheduler ??= {
  timer: null,
  status: { enabled: false, staleHours: 0, running: false, lastRunAt: null, lastResult: null, lastError: null },
});

/** What the scheduler is doing, for the health check and the Settings page. */
export function schedulerStatus(): SchedulerStatus {
  return { ...state.status, running: refreshRunning() };
}

/**
 * Keep the price history flowing without anyone having to press refresh: once
 * an hour, re-price whatever has not been priced within
 * SKINS_AUTO_REFRESH_HOURS (default 24; 0 disables). Started from
 * instrumentation.ts.
 *
 * A large inventory takes a while — Steam answers about twenty times a minute —
 * and that is fine here, because this runs in the background and skips anything
 * already fresh. Only one pass runs at a time, and that is enforced where the
 * refresh itself lives: a pass that finds one already running, from the button
 * or from the hour before, simply waits for the next hour.
 */
export function startPriceScheduler(opts: { firstAfterMs?: number; everyMs?: number } = {}): void {
  const hours = Number(process.env.SKINS_AUTO_REFRESH_HOURS ?? "24");
  state.status.enabled = Number.isFinite(hours) && hours > 0;
  state.status.staleHours = state.status.enabled ? hours : 0;
  if (!state.status.enabled) return;
  if (state.timer) return;

  const tick = async () => {
    try {
      const result = await refreshAll({ staleHours: hours });
      state.status.lastRunAt = new Date().toISOString();
      state.status.lastResult = result;
      state.status.lastError = null;
      if (result.refreshed || result.unpriced || result.failed.length) {
        console.log(
          `[prices] auto-refresh: ${result.refreshed} priced, ${result.unpriced} nothing listing, ${result.skipped} still fresh, ${result.failed.length} failed`,
        );
      }
      for (const error of result.providerErrors) console.warn(`[prices] ${error.source}: ${error.message}`);
    } catch (e) {
      if (e instanceof BusyError) return;
      state.status.lastRunAt = new Date().toISOString();
      state.status.lastError = e instanceof Error ? e.message : String(e);
      logError("prices/auto-refresh", e);
    }
  };

  // First pass shortly after boot, then hourly.
  setTimeout(tick, opts.firstAfterMs ?? 60_000).unref();
  state.timer = setInterval(tick, opts.everyMs ?? 3600_000);
  state.timer.unref();
}

/** Tests only: stop the interval and forget every run. */
export function stopPriceScheduler(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.status = { enabled: false, staleHours: 0, running: false, lastRunAt: null, lastResult: null, lastError: null };
}
