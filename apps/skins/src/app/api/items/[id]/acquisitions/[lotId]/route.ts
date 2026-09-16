import { NextResponse } from "next/server";
import { correctLot, LotEditError, type LotEditInput } from "@/lib/lot-edits";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
import { getLot, listLots } from "@/lib/acquisitions";
import { getItem, removeAcquisition } from "@/lib/items";
import { errorMessage, jsonError, parseId } from "@collectcollect/core/http";

export async function PATCH(request: Request, ctx: RouteContext<"/api/items/[id]/acquisitions/[lotId]">) {
  try {
    const params = await ctx.params;
    const id = parseId(params.id), lotId = parseId(params.lotId);
    if (!id || !lotId) return jsonError("Purchase not found", 404);
    const body = await readJsonLimited(request, 16 * 1024) as LotEditInput;
    const acquisition = correctLot(id, lotId, body);
    return NextResponse.json({ acquisition, item: getItem(id), acquisitions: listLots(id) });
  } catch (e) { return jsonError(errorMessage(e), e instanceof LotEditError || e instanceof BodyLimitError ? e.status : 400); }
}

/** Undo a purchase recorded by mistake. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/items/[id]/acquisitions/[lotId]">) {
  const params = await ctx.params;
  const id = parseId(params.id);
  const lotId = parseId(params.lotId);
  const lot = lotId ? getLot(lotId) : null;
  // The lot has to belong to the item in the path, or a guessed id could remove
  // a purchase from something else entirely.
  if (!id || !lot || lot.itemId !== id) return jsonError("Purchase not found", 404);
  try {
    const item = removeAcquisition(lot.id);
    if (!item) return jsonError("Purchase not found", 404);
    return NextResponse.json({ item, acquisitions: listLots(id) });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
