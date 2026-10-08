import { createPriceJobs } from "@collectcollect/core/price-jobs";
import { getDb } from "./db";
import { listCards } from "./cards";
import { refreshAll, refreshRunning } from "./pricing/refresh";
import { archiveGate } from "./storage";
const state = globalThis as unknown as { __cardsPriceJobs?: ReturnType<typeof createPriceJobs> };
export const priceJobs = state.__cardsPriceJobs ??= createPriceJobs({
  db: getDb, ids: () => listCards().filter(c => c.quantity > 0).map(c => c.id),
  running: () => refreshRunning() || archiveGate.busy, refresh: refreshAll,
});
