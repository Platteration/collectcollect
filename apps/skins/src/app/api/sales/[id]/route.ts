import { NextResponse } from "next/server";
import { deleteSale } from "@/lib/sales";
import { errorMessage, jsonError, parseId } from "@collectcollect/core/http";

/** DELETE — undo a sale, putting the copies back in the lots they came from. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/sales/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return jsonError("Sale not found", 404);
  try {
    return deleteSale(id) ? NextResponse.json({ ok: true }) : jsonError("Sale not found", 404);
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
