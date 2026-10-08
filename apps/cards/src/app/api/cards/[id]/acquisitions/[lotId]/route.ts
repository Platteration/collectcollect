import { NextResponse } from "next/server";
import { correctLot, LotEditError, type LotEditInput } from "@/lib/lot-edits";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
import { getCard, removeAcquisition } from "@/lib/cards";
import { getLot, listLots } from "@/lib/acquisitions";
import { errorMessage, jsonError, parseId } from "@/lib/http";

export async function PATCH(request: Request, ctx: RouteContext<"/api/cards/[id]/acquisitions/[lotId]">) {
  try {
    const params = await ctx.params;
    const id = parseId(params.id), lotId = parseId(params.lotId);
    if (!id || !lotId) return jsonError("Purchase not found", 404);
    const body = await readJsonLimited(request, 16 * 1024) as LotEditInput;
    const acquisition = correctLot(id, lotId, body);
    return NextResponse.json({ acquisition, card: getCard(id), acquisitions: listLots(id) });
  } catch (e) { return jsonError(errorMessage(e), e instanceof LotEditError || e instanceof BodyLimitError ? e.status : 400); }
}

/** DELETE — take back a purchase recorded by mistake. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/cards/[id]/acquisitions/[lotId]">) {
  const params = await ctx.params;
  const cardId = parseId(params.id);
  const lotId = parseId(params.lotId);
  const lot = lotId ? getLot(lotId) : null;
  if (!cardId || !lot || lot.cardId !== cardId) return jsonError("Purchase not found", 404);
  try {
    const card = removeAcquisition(lot.id);
    if (!card) return jsonError("Purchase not found", 404);
    return NextResponse.json({ card, acquisitions: listLots(cardId) });
  } catch (e) {
    // Refused because a sale was made from these copies.
    return jsonError(errorMessage(e), 409);
  }
}

export async function GET(_request: Request, ctx: RouteContext<"/api/cards/[id]/acquisitions/[lotId]">) {
  const params = await ctx.params;
  const lot = parseId(params.lotId) ? getLot(parseId(params.lotId)!) : null;
  if (!lot || lot.cardId !== parseId(params.id) || !getCard(lot.cardId)) return jsonError("Purchase not found", 404);
  return NextResponse.json({ acquisition: lot });
}
