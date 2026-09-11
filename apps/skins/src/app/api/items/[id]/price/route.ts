import { NextResponse } from "next/server";
import { getItem, updateItem } from "@/lib/items";
import { errorMessage, jsonError, logError, parseId } from "@collectcollect/core/http";
import { refreshItem } from "@/lib/pricing/refresh";
import { proceedsByMarket } from "@/lib/pricing/index";
import { getSettings } from "@/lib/settings";

/** POST — ask every source about this item again and record what they say. */
export async function POST(_request: Request, ctx: RouteContext<"/api/items/[id]/price">) {
  const id = parseId((await ctx.params).id);
  const item = id ? getItem(id) : null;
  if (!item) return jsonError("Item not found", 404);
  try {
    const outcome = await refreshItem(item);
    return NextResponse.json({
      summary: outcome.snapshot.summary,
      stored: outcome.stored,
      proceeds: proceedsByMarket(outcome.snapshot.summary.quotes, getSettings()),
    });
  } catch (e) {
    logError("items/price", e);
    return jsonError(`Could not price that: ${errorMessage(e)}`, 502);
  }
}

/**
 * PUT — set or clear a price of your own, which overrides every source.
 *
 * Sending null clears it and hands the item back to the market. Nothing else
 * about the item is touched.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/items/[id]/price">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getItem(id)) return jsonError("Item not found", 404);
  let body: { manualPrice?: unknown };
  try {
    body = (await request.json()) as { manualPrice?: unknown };
  } catch {
    return jsonError("Expected a JSON body");
  }
  const raw = body.manualPrice;
  if (raw !== null && raw !== undefined) {
    // A box the browser could not turn into a number arrives as null, which is
    // also how "clear this" arrives — so an unusable value is refused by name
    // rather than quietly clearing the price.
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) return jsonError("A price has to be a number, or null to clear it");
  }
  const item = updateItem(id, { manualPrice: raw === null || raw === undefined ? null : Number(raw) });
  return NextResponse.json({ item });
}
