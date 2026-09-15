import { createScheduler, type SchedulerStatus as Status } from "@collectcollect/core/scheduler";
import { refreshAll, refreshRunning, type RefreshResult } from "./pricing/refresh";

export type SchedulerStatus = Status<RefreshResult>;

/**
 * The hourly re-pricing of stale items; SKINS_AUTO_REFRESH_HOURS says how
 * stale (0 disables). A large inventory takes a while — Steam answers about
 * twenty times a minute — and that is fine in the background, since anything
 * already fresh is skipped.
 */
export const { schedulerStatus, startPriceScheduler, stopPriceScheduler } = createScheduler<RefreshResult>({
  slot: "__skinsScheduler",
  hoursEnv: "SKINS_AUTO_REFRESH_HOURS",
  refreshAll: (staleHours) => refreshAll({ staleHours }),
  refreshRunning,
  report: (r) =>
    r.refreshed || r.unpriced || r.failed.length
      ? `[prices] auto-refresh: ${r.refreshed} priced, ${r.unpriced} nothing listing, ${r.skipped} still fresh, ${r.failed.length} failed`
      : null,
  afterRun: (r) => {
    for (const error of r.providerErrors) console.warn(`[prices] ${error.source}: ${error.message}`);
  },
});
