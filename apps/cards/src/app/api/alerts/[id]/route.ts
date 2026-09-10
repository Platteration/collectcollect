import { NextResponse } from "next/server";
import { deleteAlert } from "@/lib/alerts";
import { jsonError, parseId } from "@/lib/http";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/alerts/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id || !deleteAlert(id)) return jsonError("Alert not found", 404);
  return NextResponse.json({ ok: true });
}
