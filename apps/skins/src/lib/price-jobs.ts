import { createPriceJobs } from "@collectcollect/core/price-jobs";
import { getDb } from "./db";
import { listItems } from "./items";
import { refreshAll, refreshRunning } from "./pricing/refresh";
import { archiveGate } from "./storage";
const state = globalThis as unknown as { __skinsPriceJobs?: ReturnType<typeof createPriceJobs> };
export const priceJobs = state.__skinsPriceJobs ??= createPriceJobs({
  db: getDb, ids: () => listItems().filter(c => c.quantity > 0).map(c => c.id),
  running: () => refreshRunning() || archiveGate.busy, refresh: refreshAll,
});
