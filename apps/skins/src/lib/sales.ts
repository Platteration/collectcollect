import { consumeFifo, recordSaleLots, restoreForSale, syncQuantityFromLots } from "./acquisitions";
import { getDb } from "./db";
import { discardDeferredMirror, flushDeferredMirror, getItem, refreshMirror } from "./items";
import type { Category, Sale, SaleWithItem } from "./types";
import { CATEGORIES, EXTERIORS } from "./types";

interface SaleRow {
  id: number;
  item_id: number;
  quantity: number;
  unit_price: number;
  fees: number;
  unit_cost: number | null;
  sold_at: string;
  venue: string | null;
  notes: string | null;
  created_at: string;
}

function rowToSale(r: SaleRow): Sale {
  return {
    id: r.id,
    itemId: r.item_id,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    fees: r.fees,
    unitCost: r.unit_cost,
    soldAt: r.sold_at,
    venue: r.venue,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

export interface SaleInput {
  quantity?: number;
  unitPrice: number;
  fees?: number;
  soldAt?: string;
  venue?: string | null;
  notes?: string | null;
}

/**
 * Record a sale and take the copies out of the inventory. The item row stays so
 * its history survives; quantity 0 means every copy is gone.
 */
export function recordSale(itemId: number, input: SaleInput): Sale {
  const item = getItem(itemId);
  if (!item) throw new Error("Item not found");
  const quantity = Math.floor(Number(input.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error("Sell at least one copy");
  if (quantity > item.quantity) throw new Error(`You only have ${item.quantity} cop${item.quantity === 1 ? "y" : "ies"} to sell`);
  // A price that is not a number reaches here as null, because that is what
  // JSON does with NaN — and Number(null) is 0, which would book a free sale
  // and take the copies away with it. A deliberate 0 is still allowed.
  if (input.unitPrice === null || input.unitPrice === undefined || (input.unitPrice as unknown) === "") {
    throw new Error("Sale price is required");
  }
  const unitPrice = Number(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Sale price must be a number");
  const fees = input.fees === null || input.fees === undefined ? 0 : Number(input.fees);
  if (!Number.isFinite(fees) || fees < 0) throw new Error("Fees must be a number");
  const soldAt = input.soldAt ? new Date(input.soldAt) : new Date();
  if (Number.isNaN(soldAt.getTime())) throw new Error("Sale date is not a valid date");

  // One transaction: the copies leave their lots, the sale records which lots
  // they came from, and the item's count follows the lots. A sale that got only
  // part way through would leave the cost basis lying.
  const run = getDb().transaction(() => {
    const taken = consumeFifo(itemId, quantity);
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `INSERT INTO sales (item_id, quantity, unit_price, fees, unit_cost, sold_at, venue, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        itemId,
        quantity,
        unitPrice,
        fees,
        taken.unitCost,
        soldAt.toISOString(),
        (input.venue ?? "")?.toString().trim() || null,
        (input.notes ?? "")?.toString().trim() || null,
        now,
      );
    const saleId = Number(result.lastInsertRowid);
    recordSaleLots(saleId, taken.lots);
    syncQuantityFromLots(itemId);
    return saleId;
  });

  let saleId: number;
  try {
    saleId = run();
  } catch (e) {
    discardDeferredMirror();
    throw e;
  }
  refreshMirror(itemId);
  flushDeferredMirror();
  return rowToSale(getDb().prepare("SELECT * FROM sales WHERE id = ?").get(saleId) as SaleRow);
}

export function listSalesForItem(itemId: number): Sale[] {
  return (getDb().prepare("SELECT * FROM sales WHERE item_id = ? ORDER BY sold_at DESC, id DESC").all(itemId) as SaleRow[]).map(
    rowToSale,
  );
}

export function listSales(): SaleWithItem[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*, i.market_hash_name, i.category, i.exterior, i.float_value, i.name_tag, i.stattrak
       FROM sales s JOIN items i ON i.id = s.item_id
       ORDER BY s.sold_at DESC, s.id DESC`,
    )
    .all() as Array<
    SaleRow & {
      market_hash_name: string;
      category: string;
      exterior: string | null;
      float_value: number | null;
      name_tag: string | null;
      stattrak: number;
    }
  >;
  return rows.map((r) => ({
    ...rowToSale(r),
    itemName: r.market_hash_name,
    category: r.category as Category,
    // The kind of thing it was leads, so a case or a sticker — which has no
    // wear, no float and no name tag — still says something rather than an
    // em dash.
    itemDetail: [
      CATEGORIES[r.category as Category] ?? r.category,
      r.exterior ? (EXTERIORS[r.exterior as keyof typeof EXTERIORS] ?? r.exterior) : null,
      r.stattrak ? "StatTrak™" : null,
      r.float_value === null ? null : `float ${Number(r.float_value.toFixed(10))}`,
      r.name_tag ? `“${r.name_tag}”` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

export function deleteSale(id: number): boolean {
  const sale = getDb().prepare("SELECT * FROM sales WHERE id = ?").get(id) as SaleRow | undefined;
  if (!sale) return false;
  const run = getDb().transaction(() => {
    // The lots the sale took have to be read back before the sale goes, since
    // deleting it takes its record of them with it.
    restoreForSale(sale.item_id, id);
    const removed = getDb().prepare("DELETE FROM sales WHERE id = ?").run(id).changes > 0;
    syncQuantityFromLots(sale.item_id);
    return removed;
  });
  let removed: boolean;
  try {
    removed = run();
  } catch (e) {
    discardDeferredMirror();
    throw e;
  }
  // Only now is the file rewritten, so it cannot still list the undone sale.
  refreshMirror(sale.item_id);
  flushDeferredMirror();
  return removed;
}
