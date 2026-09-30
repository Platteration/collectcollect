import { NextResponse } from "next/server";
import { getItem } from "@/lib/items";
import { listSalesForItem, recordSale, type SaleInput } from "@/lib/sales";
import { BodyLimitError, errorMessage, jsonError, parseId, readJsonLimited } from "@collectcollect/core/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/items/[id]/sales">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getItem(id)) return jsonError("Item not found", 404);
  return NextResponse.json({ sales: listSalesForItem(id) });
}

/** POST — record a sale, which also takes the copies out of the inventory. */
export async function POST(request: Request, ctx: RouteContext<"/api/items/[id]/sales">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getItem(id)) return jsonError("Item not found", 404);
  let body: SaleInput;
  try {
    // A record the form sends is far under 16 KB; a runaway client cannot buffer more.
    body = (await readJsonLimited(request, 16 * 1024)) as SaleInput;
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  try {
    const sale = recordSale(id, body);
    return NextResponse.json({ sale, item: getItem(id) }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
