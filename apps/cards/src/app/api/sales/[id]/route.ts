import { NextResponse } from "next/server";
import { jsonError, parseId } from "@/lib/http";
import { deleteSale } from "@/lib/sales";

/** DELETE — undo a sale; the copies go back into the collection. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/sales/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id || !deleteSale(id)) return jsonError("Sale not found", 404);
  return NextResponse.json({ ok: true });
}
