import { BusyError } from "@collectcollect/core/gate";
import { logError } from "@collectcollect/core/http";
import { refreshAll, refreshRunning, type RefreshResult } from "./pricing/refresh";

export interface SchedulerStatus {
  /** Whether the hourly pass is switched on at all (AUTO_REFRESH_HOURS > 0). */
  enabled: boolean;
  /** Cards older than this many hours are re-priced. */
  staleHours: number;
  /** Whether a whole-collection refresh is running right now, from any caller. */
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
const globalForScheduler = globalThis as unknown as { __collectcollectScheduler?: SchedulerState };
const state: SchedulerState = (globalForScheduler.__collectcollectScheduler ??= {
  timer: null,
  status: { enabled: false, staleHours: 0, running: false, lastRunAt: null, lastResult: null, lastError: null },
});

/** What the scheduler is doing, for the health check and the Settings page. */
export function schedulerStatus(): SchedulerStatus {
  return { ...state.status, running: refreshRunning() };
}

/**
 * Keep price history flowing without the user having to click refresh: once
 * an hour, re-price any card whose latest snapshot is older than
 * AUTO_REFRESH_HOURS (default 24; 0 disables). Started from instrumentation.ts.
 *
 * A pass that finds a refresh already running — somebody pressed the button —
 * simply waits for the next hour; that refresh is doing the same work.
 */
export function startPriceScheduler(opts: { firstAfterMs?: number; everyMs?: number } = {}): void {
  const hours = Number(process.env.AUTO_REFRESH_HOURS ?? "24");
  state.status.enabled = Number.isFinite(hours) && hours > 0;
  state.status.staleHours = state.status.enabled ? hours : 0;
  if (!state.status.enabled) return;
  if (state.timer) return;

  const tick = async () => {
    try {
      const r = await refreshAll({ staleHours: hours });
      state.status.lastRunAt = new Date().toISOString();
      state.status.lastResult = r;
      state.status.lastError = null;
      if (r.refreshed || r.unpriced || r.failed.length) {
        console.log(`[prices] auto-refresh: ${r.refreshed} refreshed, ${r.unpriced} returned no prices, ${r.skipped} fresh, ${r.failed.length} failed`);
      }
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
