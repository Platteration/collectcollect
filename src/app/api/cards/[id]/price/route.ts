import { NextResponse } from "next/server";
import { addSnapshot, getCard, updateCard } from "@/lib/cards";
import { jsonError, parseId } from "@/lib/http";
import { learnFromQuotes, priceCard } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";

/** POST — fetch fresh prices for this card and store a snapshot. */
export async function POST(_request: Request, ctx: RouteContext<"/api/cards/[id]/price">) {
  const id = parseId((await ctx.params).id);
  const card = id ? getCard(id) : null;
  if (!card) return jsonError("Card not found", 404);
  const summary = await priceCard(card, getSettings());
  const snapshot = addSnapshot(card.id, summary);
  const learned = learnFromQuotes(summary.quotes);
  const patch: Record<string, unknown> = {};
  if (Object.keys(learned.externalIds).length) patch.externalIds = { ...card.externalIds, ...learned.externalIds };
  if (!card.referenceImageUrl && learned.referenceImageUrl) patch.referenceImageUrl = learned.referenceImageUrl;
  const updated = Object.keys(patch).length ? updateCard(card.id, patch) : card;
  return NextResponse.json({ card: updated, snapshot });
}
