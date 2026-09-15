import { createScheduler, type SchedulerStatus as Status } from "@collectcollect/core/scheduler";
import { refreshAll, refreshRunning, type RefreshResult } from "./pricing/refresh";

export type SchedulerStatus = Status<RefreshResult>;

/** The hourly re-pricing of stale cards; AUTO_REFRESH_HOURS says how stale (0 disables). */
export const { schedulerStatus, startPriceScheduler, stopPriceScheduler } = createScheduler<RefreshResult>({
  slot: "__collectcollectScheduler",
  hoursEnv: "AUTO_REFRESH_HOURS",
  refreshAll: (staleHours) => refreshAll({ staleHours }),
  refreshRunning,
  report: (r) =>
    r.refreshed || r.unpriced || r.failed.length
      ? `[prices] auto-refresh: ${r.refreshed} refreshed, ${r.unpriced} returned no prices, ${r.skipped} fresh, ${r.failed.length} failed`
      : null,
});
