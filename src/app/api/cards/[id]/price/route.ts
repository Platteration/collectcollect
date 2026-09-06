import { NextResponse } from "next/server";
import { getCard } from "@/lib/cards";
import { jsonError, parseId } from "@/lib/http";
import { refreshCard } from "@/lib/pricing/refresh";

/** POST — fetch fresh prices for this card and store a snapshot. */
export async function POST(_request: Request, ctx: RouteContext<"/api/cards/[id]/price">) {
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  return NextResponse.json(await refreshCard(card));
}
