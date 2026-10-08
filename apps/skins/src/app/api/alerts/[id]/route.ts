import { NextResponse } from "next/server";
import { dismissAlert, unreadCount } from "@/lib/alerts";
import { jsonError, parseId } from "@collectcollect/core/http";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/alerts/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id || !dismissAlert(id)) return jsonError("Alert not found", 404);
  return NextResponse.json({ ok: true, unread: unreadCount() });
}
