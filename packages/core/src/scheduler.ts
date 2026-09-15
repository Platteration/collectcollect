import { BusyError } from "./gate";
import { logError } from "./http";

export interface SchedulerStatus<R> {
  /** Whether the hourly pass is switched on at all (the hours variable > 0). */
  enabled: boolean;
  /** Anything priced longer ago than this many hours is re-priced. */
  staleHours: number;
  /** Whether a whole refresh is running right now, from any caller. */
  running: boolean;
  lastRunAt: string | null;
  lastResult: R | null;
  lastError: string | null;
}

interface SchedulerState<R> {
  timer: NodeJS.Timeout | null;
  status: SchedulerStatus<R>;
}

export interface SchedulerSpec<R> {
  /** The property on the global object that holds this app's one scheduler. */
  slot: string;
  /** The environment variable saying how many hours count as stale; 0 disables. */
  hoursEnv: string;
  /** The whole refresh; throws `BusyError` when one is already running. */
  refreshAll(staleHours: number): Promise<R>;
  refreshRunning(): boolean;
  /** A line for the log after a pass, or null to say nothing. */
  report(result: R): string | null;
  /** Anything else worth logging after a pass, such as a source that would not answer. */
  afterRun?(result: R): void;
}

const fresh = <R>(): SchedulerStatus<R> => ({ enabled: false, staleHours: 0, running: false, lastRunAt: null, lastResult: null, lastError: null });

/**
 * Keep price history flowing without anyone having to press refresh: once an
 * hour, re-price whatever has not been priced within the configured number of
 * hours (default 24; 0 disables). Started from each app's instrumentation.
 *
 * One per process: Next reloads server modules in development, and a second
 * interval on top of the first would run every pass twice, which is why the
 * state lives on the global object under the app's own slot. A pass that
 * finds a refresh already running — somebody pressed the button — simply
 * waits for the next hour; that refresh is doing the same work.
 */
export function createScheduler<R>(spec: SchedulerSpec<R>) {
  const slot = globalThis as unknown as Record<string, SchedulerState<R> | undefined>;
  const state: SchedulerState<R> = (slot[spec.slot] ??= { timer: null, status: fresh<R>() });

  /** What the scheduler is doing, for the health check and the Settings page. */
  function schedulerStatus(): SchedulerStatus<R> {
    return { ...state.status, running: spec.refreshRunning() };
  }

  function startPriceScheduler(opts: { firstAfterMs?: number; everyMs?: number } = {}): void {
    const hours = Number(process.env[spec.hoursEnv] ?? "24");
    state.status.enabled = Number.isFinite(hours) && hours > 0;
    state.status.staleHours = state.status.enabled ? hours : 0;
    if (!state.status.enabled) return;
    if (state.timer) return;

    const tick = async () => {
      try {
        const result = await spec.refreshAll(hours);
        state.status.lastRunAt = new Date().toISOString();
        state.status.lastResult = result;
        state.status.lastError = null;
        const line = spec.report(result);
        if (line) console.log(line);
        spec.afterRun?.(result);
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
  function stopPriceScheduler(): void {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.status = fresh<R>();
  }

  return { schedulerStatus, startPriceScheduler, stopPriceScheduler };
}
