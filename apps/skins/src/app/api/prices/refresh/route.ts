import { NextResponse } from "next/server";
import { errorMessage, jsonError } from "@collectcollect/core/http";
import { refreshAll } from "@/lib/pricing/refresh";

/**
 * POST — price the whole inventory. `?stale=24` limits it to what has not been
 * priced in that many hours, which is what the scheduler asks for.
 *
 * Steam answers about twenty times a minute, so this is slow on purpose for a
 * large inventory. Nothing here shortens that by dropping items.
 */
export async function POST(request: Request) {
  const stale = new URL(request.url).searchParams.get("stale");
  const staleHours = stale === null ? undefined : Number(stale);
  if (staleHours !== undefined && (!Number.isFinite(staleHours) || staleHours < 0)) {
    return jsonError("stale has to be a number of hours");
  }
  try {
    return NextResponse.json({ result: await refreshAll({ staleHours }) });
  } catch (e) {
    return jsonError(`Could not refresh prices: ${errorMessage(e)}`, 502);
  }
}
