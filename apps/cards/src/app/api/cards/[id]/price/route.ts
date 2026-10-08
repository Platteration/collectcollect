import { NextResponse } from "next/server";
import { getCard } from "@/lib/cards";
import { errorMessage, jsonError, parseId } from "@/lib/http";
import { refreshCard } from "@/lib/pricing/refresh";
import { logError } from "@collectcollect/core/http";
import { createThrottle } from "@collectcollect/core/throttle";

/**
 * Each one asks every source about a card. The scan queue and a bulk refresh
 * both send one per card, so the ceiling has to clear a stack of a hundred;
 * the sources' own limiters pace the real work, and this only stops a loop.
 */
export const throttle = createThrottle(120, 60_000, "price lookups");

/** POST — fetch fresh prices for this card and store a snapshot. */
export async function POST(request: Request, ctx: RouteContext<"/api/cards/[id]/price">) {
  const refused = throttle.check(request);
  if (refused) return refused;
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  try {
    return NextResponse.json(await refreshCard(card));
  } catch (e) {
    // A source that is down is the source's problem, said as such, not a 500.
    logError("cards/price", e);
    return jsonError(`Could not price that: ${errorMessage(e)}`, 502);
  }
}
