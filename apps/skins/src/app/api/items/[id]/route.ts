import { NextResponse } from "next/server";
import { deleteItem, getItem, latestSnapshot, updateItem } from "@/lib/items";
import { errorMessage, jsonError, parseId } from "@collectcollect/core/http";
import type { ItemInput } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/items/[id]">) {
  const id = parseId((await ctx.params).id);
  const item = id ? getItem(id) : null;
  if (!item) return jsonError("Item not found", 404);
  return NextResponse.json({ item, latestPrice: latestSnapshot(item.id)?.summary ?? null });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/items/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return jsonError("Item not found", 404);
  let body: Partial<ItemInput>;
  try {
    body = (await request.json()) as Partial<ItemInput>;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    const item = updateItem(id, body);
    if (!item) return jsonError("Item not found", 404);
    return NextResponse.json({ item });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/items/[id]">) {
  const id = parseId((await ctx.params).id);
  const item = id ? getItem(id) : null;
  if (!item) return jsonError("Item not found", 404);
  deleteItem(item.id);
  return NextResponse.json({ ok: true });
}
