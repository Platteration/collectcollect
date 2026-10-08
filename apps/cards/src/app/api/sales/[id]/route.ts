import { NextResponse } from "next/server";
import { errorMessage, jsonError, parseId } from "@/lib/http";
import { deleteSale } from "@/lib/sales";

/** DELETE — undo a sale; the copies go back into the collection. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/sales/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return jsonError("Sale not found", 404);
  try {
    return deleteSale(id) ? NextResponse.json({ ok: true }) : jsonError("Sale not found", 404);
  } catch (e) {
    // Putting copies back can be refused — the card is gone, say — and that
    // is a sentence for the person, not a 500.
    return jsonError(errorMessage(e));
  }
}
