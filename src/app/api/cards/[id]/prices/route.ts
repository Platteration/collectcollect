import { NextResponse } from "next/server";
import { getCard, listSnapshots } from "@/lib/cards";
import { jsonError, parseId } from "@/lib/http";

/** GET — price history (newest first). */
export async function GET(_request: Request, ctx: RouteContext<"/api/cards/[id]/prices">) {
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  return NextResponse.json({ snapshots: listSnapshots(card.id) });
}
