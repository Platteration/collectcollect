import { NextResponse } from "next/server";
import { addAcquisition, getCard } from "@/lib/cards";
import { listLots } from "@/lib/acquisitions";
import { errorMessage, jsonError, parseId } from "@/lib/http";
import type { AcquisitionInput } from "@/lib/acquisitions";

/** GET — what every copy of this card cost, oldest purchase first. */
export async function GET(_request: Request, ctx: RouteContext<"/api/cards/[id]/acquisitions">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getCard(id)) return jsonError("Card not found", 404);
  return NextResponse.json({ acquisitions: listLots(id) });
}

/**
 * POST — record another purchase of a card already held. This is how copies are
 * added: bumping the quantity instead would say how many there are without
 * saying what they cost.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/cards/[id]/acquisitions">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getCard(id)) return jsonError("Card not found", 404);
  let body: AcquisitionInput;
  try {
    body = (await request.json()) as AcquisitionInput;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    const card = addAcquisition(id, body);
    if (!card) return jsonError("Card not found", 404);
    return NextResponse.json({ card, acquisitions: listLots(id) }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
