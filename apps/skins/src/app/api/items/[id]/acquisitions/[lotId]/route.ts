import { NextResponse } from "next/server";
import { getLot, listLots } from "@/lib/acquisitions";
import { removeAcquisition } from "@/lib/items";
import { errorMessage, jsonError, parseId } from "@collectcollect/core/http";

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
