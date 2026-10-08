import { NextResponse } from "next/server";
import { getCard } from "@/lib/cards";
import { errorMessage, jsonError, parseId } from "@/lib/http";
import { BodyLimitError, readJsonLimited } from "@collectcollect/core/http";
import { listSalesForCard, recordSale, type SaleInput } from "@/lib/sales";

export async function GET(_request: Request, ctx: RouteContext<"/api/cards/[id]/sales">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getCard(id)) return jsonError("Card not found", 404);
  return NextResponse.json({ sales: listSalesForCard(id) });
}

/** POST — log a sale of one or more copies; the copies leave the collection. */
export async function POST(request: Request, ctx: RouteContext<"/api/cards/[id]/sales">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getCard(id)) return jsonError("Card not found", 404);
  let body: SaleInput;
  // A sale is a handful of numbers and a note; a runaway client cannot buffer more than 16 KB here.
  try {
    body = (await readJsonLimited(request, 16 * 1024)) as SaleInput;
  } catch (e) {
    if (e instanceof BodyLimitError) return jsonError(e.message, 413);
    return jsonError("Expected a JSON body");
  }
  try {
    const sale = recordSale(id, body);
    return NextResponse.json({ sale, card: getCard(id) }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
