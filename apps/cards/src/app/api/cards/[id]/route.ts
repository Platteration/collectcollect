import { NextResponse } from "next/server";
import { deleteCard, getCard, latestSnapshot, updateCard } from "@/lib/cards";
import { deleteUpload } from "@/lib/images";
import { errorMessage, jsonError, parseId } from "@/lib/http";
import type { CardInput } from "@/lib/types";

export async function GET(_request: Request, ctx: RouteContext<"/api/cards/[id]">) {
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  return NextResponse.json({ card, latestPrice: latestSnapshot(card.id)?.summary ?? null });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/cards/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return jsonError("Card not found", 404);
  let body: Partial<CardInput>;
  try {
    body = (await request.json()) as Partial<CardInput>;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    const card = updateCard(id, body);
    if (!card) return jsonError("Card not found", 404);
    return NextResponse.json({ card });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/cards/[id]">) {
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  deleteCard(card.id);
  if (card.imagePath) await deleteUpload(card.imagePath);
  return NextResponse.json({ ok: true });
}
