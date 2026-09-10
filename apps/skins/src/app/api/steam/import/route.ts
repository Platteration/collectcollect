import { NextResponse } from "next/server";
import { itemsMissingFrom, syncFromInventory } from "@/lib/items";
import { errorMessage, jsonError } from "@collectcollect/core/http";
import { SteamInventoryError, fetchInventory, parseInventory } from "@/lib/steam/inventory";
import type { ItemInput } from "@/lib/types";

export interface SteamImportResult {
  created: number;
  updated: number;
  increased: number;
  decreased: number;
  unchanged: number;
  /** Assets Steam sent with no description, so nothing is known about them. */
  unmatched: number;
  /** Objects this app holds that the inventory did not mention. Nothing is removed. */
  missing: Array<{ id: number; name: string }>;
  failed: Array<{ name: string; reason: string }>;
}

/**
 * POST — read a public Steam inventory and bring it in.
 *
 * `preview: true` reads and parses without writing anything, so someone can see
 * what an import would do before it does it.
 *
 * This is a reading of a whole inventory, so what it says is the truth about
 * how many of a thing you hold rather than an amount to add. Running it twice
 * on an unchanged inventory therefore changes nothing — which matters, because
 * an import is exactly the thing people run more than once.
 *
 * Nothing here invents a purchase price. Steam knows what you own, not what you
 * paid, and filling that in with the market price would turn every item into an
 * apparent break-even and quietly destroy the one number this app exists to
 * keep.
 */
export async function POST(request: Request) {
  let body: { steamId?: unknown; preview?: unknown };
  try {
    body = (await request.json()) as { steamId?: unknown; preview?: unknown };
  } catch {
    return jsonError("Expected a JSON body");
  }
  const steamId = typeof body.steamId === "string" ? body.steamId.trim() : "";
  if (!steamId) return jsonError("A SteamID64 is required");

  let items: ItemInput[];
  let unmatched: number;
  try {
    const parsed = parseInventory(await fetchInventory(steamId), steamId);
    items = parsed.items;
    unmatched = parsed.unmatched;
  } catch (e) {
    // A private inventory or a rate limit is something the person can act on,
    // so it comes back as a sentence rather than a 500.
    if (e instanceof SteamInventoryError) return jsonError(e.message, 400);
    return jsonError(`Could not read that inventory: ${errorMessage(e)}`, 502);
  }

  if (body.preview === true) {
    return NextResponse.json({ preview: items, unmatched });
  }

  const result: SteamImportResult = {
    created: 0,
    updated: 0,
    increased: 0,
    decreased: 0,
    unchanged: 0,
    unmatched,
    missing: [],
    failed: [],
  };
  for (const item of items) {
    try {
      result[syncFromInventory(item).result]++;
    } catch (e) {
      // One unreadable item must not cost the other four hundred.
      result.failed.push({ name: item.marketHashName, reason: errorMessage(e) });
    }
  }
  result.missing = itemsMissingFrom(items.map((i) => i.assetId).filter((id): id is string => Boolean(id))).map((item) => ({
    id: item.id,
    name: item.marketHashName,
  }));
  return NextResponse.json({ result });
}
