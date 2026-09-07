import { getCard, updateCard } from "./cards";
import { getDb } from "./db";
import type { Game, Sale, SaleWithCard } from "./types";

interface SaleRow {
  id: number;
  card_id: number;
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
    cardId: r.card_id,
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
 * Record a sale and take the copies out of the collection. The card row stays
 * so its history and photo survive; quantity 0 means every copy is gone.
 */
export function recordSale(cardId: number, input: SaleInput): Sale {
  const card = getCard(cardId);
  if (!card) throw new Error("Card not found");
  const quantity = Math.floor(Number(input.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1) throw new Error("Sell at least one copy");
  if (quantity > card.quantity) throw new Error(`You only have ${card.quantity} cop${card.quantity === 1 ? "y" : "ies"} to sell`);
  const unitPrice = Number(input.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Sale price must be a number");
  const fees = Number(input.fees ?? 0);
  if (!Number.isFinite(fees) || fees < 0) throw new Error("Fees must be a number");
  const soldAt = input.soldAt ? new Date(input.soldAt) : new Date();
  if (Number.isNaN(soldAt.getTime())) throw new Error("Sale date is not a valid date");

  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO sales (card_id, quantity, unit_price, fees, unit_cost, sold_at, venue, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cardId,
      quantity,
      unitPrice,
      fees,
      card.purchasePrice,
      soldAt.toISOString(),
      (input.venue ?? "")?.toString().trim() || null,
      (input.notes ?? "")?.toString().trim() || null,
      now,
    );
  updateCard(cardId, { quantity: card.quantity - quantity });
  return rowToSale(getDb().prepare("SELECT * FROM sales WHERE id = ?").get(Number(result.lastInsertRowid)) as SaleRow);
}

export function listSalesForCard(cardId: number): Sale[] {
  return (getDb().prepare("SELECT * FROM sales WHERE card_id = ? ORDER BY sold_at DESC, id DESC").all(cardId) as SaleRow[]).map(rowToSale);
}

export function listSales(): SaleWithCard[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*, c.name AS card_name, c.game, c.set_name, c.card_number, c.year, c.grade, c.grading_company
       FROM sales s JOIN cards c ON c.id = s.card_id
       ORDER BY s.sold_at DESC, s.id DESC`,
    )
    .all() as Array<SaleRow & { card_name: string; game: string; set_name: string | null; card_number: string | null; year: number | null; grade: string | null; grading_company: string | null }>;
  return rows.map((r) => ({
    ...rowToSale(r),
    cardName: r.card_name,
    game: r.game as Game,
    cardDetail:
      [r.set_name, r.card_number ? `#${r.card_number}` : null, r.year, r.grade ? `${r.grading_company ?? "Graded"} ${r.grade}` : null]
        .filter(Boolean)
        .join(" · ") || "—",
  }));
}

export function deleteSale(id: number): boolean {
  const sale = getDb().prepare("SELECT * FROM sales WHERE id = ?").get(id) as SaleRow | undefined;
  if (!sale) return false;
  const card = getCard(sale.card_id);
  if (card) updateCard(card.id, { quantity: card.quantity + sale.quantity });
  return getDb().prepare("DELETE FROM sales WHERE id = ?").run(id).changes > 0;
}
