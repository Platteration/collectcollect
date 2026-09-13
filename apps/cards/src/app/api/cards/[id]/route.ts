import { NextResponse } from "next/server";
import { HasSalesError, deleteCard, getCard, latestSnapshot, updateCard } from "@/lib/cards";
import fs from "node:fs";
import { deleteUpload, isValidUploadName, uploadPath } from "@/lib/images";
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
  // A photo has to be one this app stored: a name of the wrong shape, or one
  // nothing was uploaded under, is refused by name rather than quietly
  // dropped, so a page that set it finds out.
  if (typeof body.imagePath === "string" && body.imagePath) {
    if (!isValidUploadName(body.imagePath) || !fs.existsSync(uploadPath(body.imagePath))) {
      return jsonError("That photo is not one this app stored; upload it first");
    }
  }
  const previous = getCard(id);
  if (!previous) return jsonError("Card not found", 404);
  try {
    const card = updateCard(id, body);
    if (!card) return jsonError("Card not found", 404);
    // A photo replaced or removed has no card left to belong to; the file goes
    // once the row is written, never before.
    if (previous.imagePath && previous.imagePath !== card.imagePath) await deleteUpload(previous.imagePath);
    return NextResponse.json({ card });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/cards/[id]">) {
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  try {
    deleteCard(card.id);
  } catch (e) {
    // A sold card keeps its history; the answer is a reason, not a 500.
    if (e instanceof HasSalesError) return jsonError(e.message, 409);
    throw e;
  }
  if (card.imagePath) await deleteUpload(card.imagePath);
  return NextResponse.json({ ok: true });
}
