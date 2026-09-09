import { NextResponse } from "next/server";
import { getCard } from "@/lib/cards";
import { jsonError, parseId, tooManyRequests } from "@/lib/http";
import { CARD_PRICE_PER_HOUR, HOUR_MS, rateLimit } from "@/lib/rate-limit";
import { refreshCard } from "@/lib/pricing/refresh";

/** POST — fetch fresh prices for this card and store a snapshot. */
export async function POST(_request: Request, ctx: RouteContext<"/api/cards/[id]/price">) {
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  const limit = rateLimit("card-price", CARD_PRICE_PER_HOUR, HOUR_MS);
  if (!limit.ok) {
    return tooManyRequests(`Too many price lookups in the last hour (limit ${CARD_PRICE_PER_HOUR}).`, limit.retryAfter);
  }
  return NextResponse.json(await refreshCard(card));
}
