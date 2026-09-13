import { NextResponse } from "next/server";
import { itemsMissingFrom, syncFromInventory } from "@/lib/items";
import { errorMessage, jsonError, logError } from "@collectcollect/core/http";
import { SteamInventoryError, fetchInventory, parseInventory } from "@/lib/steam/inventory";
import type { ItemInput } from "@/lib/types";
import { createThrottle } from "@collectcollect/core/throttle";

export interface SteamImportResult {
  created: number;
  updated: number;
  increased: number;
  unchanged: number;
  /** Assets Steam sent with no description, so nothing is known about them. */
  unmatched: number;
  /** Objects this app holds that the inventory did not mention. Nothing is removed. */
  missing: Array<{ id: number; name: string }>;
  /**
   * Stacks the inventory showed fewer of than are held here. Nothing is
   * changed: the rest may be in a storage unit, which Steam does not show.
   */
  fewer: Array<{ id: number; name: string; held: number; seen: number }>;
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
 * an import is exactly the thing people run more than once. It only ever adds:
 * a stack the inventory shows fewer of is reported, never shrunk, because the
 * copies are as likely to be in a storage unit as gone.
 *
 * Nothing here invents a purchase price. Steam knows what you own, not what you
 * paid, and filling that in with the market price would turn every item into an
 * apparent break-even and quietly destroy the one number this app exists to
 * keep.
 */
/** Steam refuses inventories asked for too often, and a refusal is worse than a wait. */
export const throttle = createThrottle(6, 60_000, "inventory reads");

export async function POST(request: Request) {
  const refused = throttle.check(request);
  if (refused) return refused;
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
    logError("steam/import", e);
    return jsonError(`Could not read that inventory: ${errorMessage(e)}`, 502);
  }

  if (body.preview === true) {
    return NextResponse.json({ preview: items, unmatched });
  }

  const result: SteamImportResult = {
    created: 0,
    updated: 0,
    increased: 0,
    unchanged: 0,
    unmatched,
    missing: [],
    fewer: [],
    failed: [],
  };
  for (const item of items) {
    try {
      const outcome = syncFromInventory(item);
      if (outcome.result === "fewer") {
        result.fewer.push({ id: outcome.item.id, name: outcome.item.marketHashName, held: outcome.held, seen: outcome.seen });
      } else {
        result[outcome.result]++;
      }
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
