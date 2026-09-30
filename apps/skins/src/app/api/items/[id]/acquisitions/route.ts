import { NextResponse } from "next/server";
import { listLots, type AcquisitionInput } from "@/lib/acquisitions";
import { addAcquisition, getItem } from "@/lib/items";
import { BodyLimitError, errorMessage, jsonError, parseId, readJsonLimited } from "@collectcollect/core/http";

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
    // A record the form sends is far under 16 KB; a runaway client cannot buffer more.
    body = (await readJsonLimited(request, 16 * 1024)) as AcquisitionInput;
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
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
