import { NextResponse } from "next/server";
import { getItem, listSnapshots } from "@/lib/items";
import { jsonError, parseId } from "@collectcollect/core/http";

/** GET — everything ever recorded for this item, newest first. */
export async function GET(_request: Request, ctx: RouteContext<"/api/items/[id]/prices">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getItem(id)) return jsonError("Item not found", 404);
  return NextResponse.json({ snapshots: listSnapshots(id, 200) });
}
