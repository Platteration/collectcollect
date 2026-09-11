import { NextResponse } from "next/server";
import { BusyError } from "@collectcollect/core/gate";
import { errorMessage, jsonError, logError } from "@collectcollect/core/http";
import { createThrottle } from "@collectcollect/core/throttle";
import { refreshAll } from "@/lib/pricing/refresh";

/** A whole-collection refresh is minutes of work against free APIs; six an hour is plenty. */
export const throttle = createThrottle(6, 60_000, "price refreshes");

/**
 * POST — refresh prices for every card. `?stale=24` limits it to cards not
 * refreshed in that many hours, which is what the scheduler asks for.
 *
 * Only one runs at a time: a second request while one is under way is told
 * so with a 409, since the answer it wants is already being produced.
 */
export async function POST(request: Request) {
  const refused = throttle.check(request);
  if (refused) return refused;
  const stale = new URL(request.url).searchParams.get("stale");
  let staleHours: number | undefined;
  if (stale !== null) {
    staleHours = Number(stale);
    if (stale.trim() === "" || !Number.isFinite(staleHours) || staleHours < 0) return jsonError("stale has to be a number of hours");
  }
  try {
    return NextResponse.json(await refreshAll({ staleHours }));
  } catch (e) {
    if (e instanceof BusyError) return jsonError(e.message, 409);
    logError("prices/refresh", e);
    return jsonError(`Could not refresh prices: ${errorMessage(e)}`, 502);
  }
}
