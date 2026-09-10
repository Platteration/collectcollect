import { NextResponse } from "next/server";
import { getCard } from "@/lib/cards";
import { errorMessage, jsonError, parseId } from "@/lib/http";
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
  try {
    body = (await request.json()) as SaleInput;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    const sale = recordSale(id, body);
    return NextResponse.json({ sale, card: getCard(id) }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
