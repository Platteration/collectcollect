import { latestSnapshotsByItem, listItems } from "@/lib/items";
import { listSales } from "@/lib/sales";
import { CATEGORIES, EXTERIORS, RARITIES } from "@/lib/types";
import { valueOf } from "@/lib/valuation";

/**
 * The inventory as a spreadsheet.
 *
 * Written so it can be read straight back in: the column names are the ones the
 * importer recognises, so an export is also a backup you can restore from, and
 * a starting point for filling in what you paid.
 */

const COLUMNS = [
  "id", "name", "category", "weapon", "finish", "exterior", "float", "seed", "paint_index", "rarity", "collection",
  "stattrak", "souvenir", "name_tag", "quantity", "cost", "value_each", "value_total", "price_source", "price_date",
  "storage", "tradelock", "asset_id", "image", "notes",
] as const;

const SALE_COLUMNS = [
  "sale_id", "item_id", "name", "detail", "sold_at", "quantity", "unit_price", "fees", "net", "unit_cost", "gain", "venue", "notes",
] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection: a leading = + - @ or tab/CR would
  // be evaluated by Excel or Sheets. An item name legitimately starts with a
  // star, and market hash names come from Steam, but a note does not.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function inventoryCsv(): string {
  const latest = latestSnapshotsByItem();
  const lines = [COLUMNS.join(",")];
  for (const item of listItems()) {
    const snapshot = latest.get(item.id);
    const { value, basis } = valueOf(item, snapshot);
    lines.push(
      [
        item.id,
        item.marketHashName,
        CATEGORIES[item.category],
        item.weapon,
        item.finish,
        item.exterior ? EXTERIORS[item.exterior] : null,
        // Full precision: a float rounded for display is a different object.
        item.floatValue === null ? null : Number(item.floatValue.toFixed(10)),
        item.paintSeed,
        item.paintIndex,
        item.rarity ? RARITIES[item.rarity].label : null,
        item.collection,
        item.stattrak ? "yes" : "",
        item.souvenir ? "yes" : "",
        item.nameTag,
        item.quantity,
        item.purchasePrice,
        value,
        value === null ? null : Math.round(value * item.quantity * 100) / 100,
        basis,
        snapshot?.fetchedAt ?? null,
        item.storageUnit,
        item.tradableAfter,
        item.assetId,
        item.imageUrl,
        item.notes,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

function salesCsv(): string {
  const lines = [SALE_COLUMNS.join(",")];
  for (const sale of listSales()) {
    const net = Math.round((sale.unitPrice * sale.quantity - sale.fees) * 100) / 100;
    const gain = sale.unitCost === null ? null : Math.round((net - sale.unitCost * sale.quantity) * 100) / 100;
    lines.push(
      [
        sale.id,
        sale.itemId,
        sale.itemName,
        sale.itemDetail,
        sale.soldAt,
        sale.quantity,
        sale.unitPrice,
        sale.fees,
        net,
        sale.unitCost,
        gain,
        sale.venue,
        sale.notes,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** GET — the inventory as CSV, or `?type=sales` for the sales ledger. */
export async function GET(request: Request) {
  const date = new Date().toISOString().slice(0, 10);
  const sales = new URL(request.url).searchParams.get("type") === "sales";
  return new Response(sales ? salesCsv() : inventoryCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="collectcollect-skins-${sales ? "sales-" : ""}${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
