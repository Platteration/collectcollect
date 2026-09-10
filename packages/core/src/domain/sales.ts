import type { Ledger } from "./acquisitions";
import type { DomainDb } from "./db";
import type { Repository } from "./repository";
import type { DomainSpec, ItemRecord, Sale, SaleWithItem } from "./spec";

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

export type Sales = ReturnType<typeof createSales>;

/**
 * Sales take copies out of the oldest purchase still holding any, record
 * which lots they took, and leave the row so its history survives. Undoing a
 * sale puts the copies back where they came from.
 */
export function createSales<F extends object, X extends object>(ctx: {
  spec: Pick<DomainSpec<F>, "title" | "detail">;
  db: DomainDb;
  ledger: Ledger;
  repo: Repository<F, X>;
}) {
  const { spec, db, ledger, repo } = ctx;
  const getDb = db.getDb;

  function recordSale(itemId: number, input: SaleInput): Sale {
    const item = repo.getItem(itemId);
    if (!item) throw new Error("Item not found");
    const quantity = Math.floor(Number(input.quantity ?? 1));
    if (!Number.isFinite(quantity) || quantity < 1) throw new Error("Sell at least one copy");
    if (quantity > item.quantity) throw new Error(`You only have ${item.quantity} cop${item.quantity === 1 ? "y" : "ies"} to sell`);
    // A price that is not a number reaches here as null, because that is what
    // JSON does with NaN — and Number(null) is 0, which would book a free sale.
    if (input.unitPrice === null || input.unitPrice === undefined || (input.unitPrice as unknown) === "") {
      throw new Error("Sale price is required");
    }
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Sale price must be a number");
    const fees = input.fees === null || input.fees === undefined ? 0 : Number(input.fees);
    if (!Number.isFinite(fees) || fees < 0) throw new Error("Fees must be a number");
    const soldAt = input.soldAt ? new Date(input.soldAt) : new Date();
    if (Number.isNaN(soldAt.getTime())) throw new Error("Sale date is not a valid date");

    const run = getDb().transaction(() => {
      const taken = ledger.consumeFifo(itemId, quantity);
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
          new Date().toISOString(),
        );
      const saleId = Number(result.lastInsertRowid);
      ledger.recordSaleLots(saleId, taken.lots);
      ledger.syncQuantityFromLots(itemId);
      return saleId;
    });

    let saleId: number;
    try {
      saleId = run();
    } catch (e) {
      repo.discardDeferredMirror();
      throw e;
    }
    repo.refreshMirror(itemId);
    repo.flushDeferredMirror();
    return rowToSale(getDb().prepare("SELECT * FROM sales WHERE id = ?").get(saleId) as SaleRow);
  }

  function listSalesForItem(itemId: number): Sale[] {
    return (getDb().prepare("SELECT * FROM sales WHERE item_id = ? ORDER BY sold_at DESC, id DESC").all(itemId) as SaleRow[]).map(rowToSale);
  }

  function listSales(): SaleWithItem[] {
    const rows = (getDb().prepare("SELECT * FROM sales ORDER BY sold_at DESC, id DESC").all() as SaleRow[]).map(rowToSale);
    const items = new Map<number, ItemRecord<F>>();
    return rows.map((sale) => {
      let item = items.get(sale.itemId);
      if (!item) {
        item = repo.getItem(sale.itemId) ?? undefined;
        if (item) items.set(sale.itemId, item);
      }
      return {
        ...sale,
        itemName: item ? spec.title(item) : `#${sale.itemId}`,
        itemDetail: item ? spec.detail(item) || "—" : "—",
      };
    });
  }

  function deleteSale(id: number): boolean {
    const sale = getDb().prepare("SELECT * FROM sales WHERE id = ?").get(id) as SaleRow | undefined;
    if (!sale) return false;
    const run = getDb().transaction(() => {
      ledger.restoreForSale(sale.item_id, id);
      const removed = getDb().prepare("DELETE FROM sales WHERE id = ?").run(id).changes > 0;
      ledger.syncQuantityFromLots(sale.item_id);
      return removed;
    });
    let removed: boolean;
    try {
      removed = run();
    } catch (e) {
      repo.discardDeferredMirror();
      throw e;
    }
    repo.refreshMirror(sale.item_id);
    repo.flushDeferredMirror();
    return removed;
  }

  return { recordSale, listSalesForItem, listSales, deleteSale };
}
