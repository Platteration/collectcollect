import { NextResponse } from "next/server";
import { createItem, latestSnapshotsByItem, listItems, type ListOptions } from "@/lib/items";
import { errorMessage, jsonError } from "@collectcollect/core/http";
import type { Category, Exterior, ItemInput, Rarity } from "@/lib/types";
import { CATEGORY_IDS, EXTERIOR_IDS, RARITY_IDS } from "@/lib/types";

/** Only a value the app knows survives into a query; anything else is dropped. */
function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const opts: ListOptions = {
    category: pick<Category>(url.searchParams.get("category"), CATEGORY_IDS),
    exterior: pick<Exterior>(url.searchParams.get("exterior"), EXTERIOR_IDS),
    rarity: pick<Rarity>(url.searchParams.get("rarity"), RARITY_IDS),
    stattrak: url.searchParams.get("stattrak") === "1" ? true : undefined,
    lockedOnly: url.searchParams.get("locked") === "1" ? true : undefined,
    search: url.searchParams.get("q") ?? undefined,
    storageUnit: url.searchParams.get("unit") ?? undefined,
  };
  const items = listItems(opts);
  const prices = latestSnapshotsByItem();
  return NextResponse.json({
    items: items.map((i) => ({ ...i, latestPrice: prices.get(i.id)?.summary ?? null })),
  });
}

export async function POST(request: Request) {
  let body: ItemInput;
  try {
    body = (await request.json()) as ItemInput;
  } catch {
    return jsonError("Expected a JSON body");
  }
  try {
    return NextResponse.json({ item: createItem(body) }, { status: 201 });
  } catch (e) {
    return jsonError(errorMessage(e));
  }
}
