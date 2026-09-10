import { NextResponse } from "next/server";
import { listLots, type AcquisitionInput } from "@/lib/acquisitions";
import { addAcquisition, getItem } from "@/lib/items";
import { errorMessage, jsonError, parseId } from "@collectcollect/core/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/items/[id]/acquisitions">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getItem(id)) return jsonError("Item not found", 404);
  return NextResponse.json({ acquisitions: listLots(id) });
}

/** Record another purchase of something already held. */
export async function POST(request: Request, ctx: RouteContext<"/api/items/[id]/acquisitions">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getItem(id)) return jsonError("Item not found", 404);
  let body: AcquisitionInput;
  try {
    body = (await request.json()) as AcquisitionInput;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    const item = addAcquisition(id, body);
    if (!item) return jsonError("Item not found", 404);
    return NextResponse.json({ item, acquisitions: listLots(id) }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
