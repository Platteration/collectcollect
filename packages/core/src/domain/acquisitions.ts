import type Database from "better-sqlite3";

/**
 * Where each copy of an item came from and what it cost.
 *
 * Each purchase is its own lot, sales consume lots oldest first, and
 * `items.purchase_price` becomes a weighted average of what is still held —
 * derived from these rows rather than owned directly.
 *
 * A null `unitCost` is a real state, not a missing value: plenty of things
 * arrive as a gift, in a bulk lot or from a childhood shoebox. Those copies
 * are counted separately rather than being priced at zero, which would read as
 * pure profit.
 *
 * This module knows nothing about what is being collected, and imports nothing
 * from the repository above it: it is the data layer, and the repository owns
 * the transaction and the Markdown mirror around these calls.
 */

export interface Acquisition {
  id: number;
  itemId: number;
  /** Copies this lot brought in, including any since sold. */
  quantity: number;
  /** Copies from this lot still held. */
  remaining: number;
  /** What each copy in the lot cost, or null when that is not known. */
  unitCost: number | null;
  acquiredAt: string;
  source: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AcquisitionInput {
  quantity?: number;
  unitCost?: number | null;
  acquiredAt?: string;
  source?: string | null;
  notes?: string | null;
}

export interface CostBasis {
  /** Money spent on the copies still held, over the lots whose cost is known. */
  invested: number;
  copiesWithCost: number;
  copiesWithoutCost: number;
}

export interface Consumed {
  acquisitionId: number | null;
  quantity: number;
  unitCost: number | null;
}

interface LotRow {
  id: number;
  item_id: number;
  quantity: number;
  remaining: number;
  unit_cost: number | null;
  acquired_at: string;
  source: string | null;
  notes: string | null;
  created_at: string;
}

function rowToLot(r: LotRow): Acquisition {
  return {
    id: r.id,
    itemId: r.item_id,
    quantity: r.quantity,
    remaining: r.remaining,
    unitCost: r.unit_cost,
    acquiredAt: r.acquired_at,
    source: r.source,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The average paid per copy across the lots a sale took — but only when every
 * copy it took has a recorded cost. Blending the ones that are known would look
 * like a complete answer while quietly understating what the sale actually
 * cost, which is the same class of mistake lots exist to remove.
 */
export function blendedCost(lots: Consumed[]): number | null {
  let spend = 0;
  let copies = 0;
  for (const lot of lots) {
    if (lot.unitCost === null) return null;
    spend += lot.unitCost * lot.quantity;
    copies += lot.quantity;
  }
  return copies > 0 ? Math.round((spend / copies) * 100) / 100 : null;
}

export function basisFromLots(lots: Acquisition[]): CostBasis {
  let invested = 0;
  let copiesWithCost = 0;
  let copiesWithoutCost = 0;
  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    if (lot.unitCost === null) copiesWithoutCost += lot.remaining;
    else {
      invested += lot.unitCost * lot.remaining;
      copiesWithCost += lot.remaining;
    }
  }
  return { invested: Math.round(invested * 100) / 100, copiesWithCost, copiesWithoutCost };
}

export type Ledger = ReturnType<typeof createLedger>;

export function createLedger(getDb: () => Database.Database) {
  /** Oldest first, which is also the order sales consume them in. */
  function listLots(itemId: number): Acquisition[] {
    return (getDb().prepare("SELECT * FROM acquisitions WHERE item_id = ? ORDER BY acquired_at, id").all(itemId) as LotRow[]).map(rowToLot);
  }

  function getLot(id: number): Acquisition | null {
    const row = getDb().prepare("SELECT * FROM acquisitions WHERE id = ?").get(id) as LotRow | undefined;
    return row ? rowToLot(row) : null;
  }

  /** Record a purchase. Returns the lot as stored. */
  function addLot(itemId: number, input: AcquisitionInput = {}): Acquisition {
    const quantity = Math.max(1, Math.floor(Number(input.quantity ?? 1)) || 1);
    const when = input.acquiredAt ? new Date(input.acquiredAt) : new Date();
    if (Number.isNaN(when.getTime())) throw new Error("Acquisition date is not a valid date");
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `INSERT INTO acquisitions (item_id, quantity, remaining, unit_cost, acquired_at, source, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        itemId,
        quantity,
        quantity,
        money(input.unitCost),
        when.toISOString(),
        (input.source ?? "")?.toString().trim() || null,
        (input.notes ?? "")?.toString().trim() || null,
        now,
      );
    return getLot(Number(result.lastInsertRowid))!;
  }

  /**
   * Remove a lot entirely. Only a lot nothing has been sold from can go: the
   * copies sold out of it are part of a sale's cost basis, and deleting it
   * would rewrite money that has already changed hands.
   */
  function deleteLot(id: number): boolean {
    const lot = getLot(id);
    if (!lot) return false;
    if (lot.remaining !== lot.quantity) {
      throw new Error("Copies from this purchase have already been sold, so it cannot be removed");
    }
    return getDb().prepare("DELETE FROM acquisitions WHERE id = ?").run(id).changes > 0;
  }

  /**
   * Take `quantity` copies from the oldest lots first. A shortfall — which
   * should not happen while the invariant holds — is recorded against no lot,
   * with an unknown cost, rather than losing the sale.
   */
  function consumeFifo(itemId: number, quantity: number): { lots: Consumed[]; unitCost: number | null } {
    const db = getDb();
    const lots: Consumed[] = [];
    let left = quantity;
    for (const lot of listLots(itemId)) {
      if (left <= 0) break;
      if (lot.remaining <= 0) continue;
      const take = Math.min(lot.remaining, left);
      db.prepare("UPDATE acquisitions SET remaining = remaining - ? WHERE id = ?").run(take, lot.id);
      lots.push({ acquisitionId: lot.id, quantity: take, unitCost: lot.unitCost });
      left -= take;
    }
    if (left > 0) lots.push({ acquisitionId: null, quantity: left, unitCost: null });
    return { lots, unitCost: blendedCost(lots) };
  }

  function recordSaleLots(saleId: number, lots: Consumed[]): void {
    const insert = getDb().prepare("INSERT INTO sale_lots (sale_id, acquisition_id, quantity, unit_cost) VALUES (?, ?, ?, ?)");
    for (const lot of lots) insert.run(saleId, lot.acquisitionId, lot.quantity, lot.unitCost);
  }

  function listSaleLots(saleId: number): Consumed[] {
    return (
      getDb().prepare("SELECT acquisition_id, quantity, unit_cost FROM sale_lots WHERE sale_id = ? ORDER BY id").all(saleId) as Array<{
        acquisition_id: number | null;
        quantity: number;
        unit_cost: number | null;
      }>
    ).map((r) => ({ acquisitionId: r.acquisition_id, quantity: r.quantity, unitCost: r.unit_cost }));
  }

  /** Put the copies a sale took back where they came from; a lot since gone is recreated from what the sale recorded. */
  function restoreForSale(itemId: number, saleId: number): void {
    const db = getDb();
    for (const lot of listSaleLots(saleId)) {
      const target = lot.acquisitionId === null ? null : getLot(lot.acquisitionId);
      if (target) db.prepare("UPDATE acquisitions SET remaining = remaining + ? WHERE id = ?").run(lot.quantity, target.id);
      else addLot(itemId, { quantity: lot.quantity, unitCost: lot.unitCost, source: "restored" });
    }
  }

  /**
   * Make the lots add up to a quantity that was set directly. More copies than
   * the lots know about become a lot with an unknown cost; fewer are taken off
   * the newest lots first, since an unexplained reduction is most likely
   * undoing a recent addition.
   */
  function reconcileToQuantity(itemId: number, quantity: number): void {
    const db = getDb();
    const lots = listLots(itemId);
    const held = lots.reduce((n, lot) => n + lot.remaining, 0);
    if (held === quantity) return;
    if (quantity > held) {
      addLot(itemId, { quantity: quantity - held, unitCost: null, source: "adjustment" });
      return;
    }
    let over = held - quantity;
    for (const lot of [...lots].reverse()) {
      if (over <= 0) break;
      if (lot.remaining <= 0) continue;
      const take = Math.min(lot.remaining, over);
      const remaining = lot.remaining - take;
      const size = lot.quantity - take;
      if (size <= 0) db.prepare("DELETE FROM acquisitions WHERE id = ?").run(lot.id);
      else db.prepare("UPDATE acquisitions SET quantity = ?, remaining = ? WHERE id = ?").run(size, remaining, lot.id);
      over -= take;
    }
  }

  function costBasis(itemId: number): CostBasis {
    return basisFromLots(listLots(itemId));
  }

  /** Cost basis for every item at once, for the portfolio figures. */
  function costBasisByItem(): Map<number, CostBasis> {
    const rows = getDb().prepare("SELECT * FROM acquisitions WHERE remaining > 0 ORDER BY item_id, acquired_at, id").all() as LotRow[];
    const byItem = new Map<number, Acquisition[]>();
    for (const row of rows) {
      const lot = rowToLot(row);
      const list = byItem.get(lot.itemId);
      if (list) list.push(lot);
      else byItem.set(lot.itemId, [lot]);
    }
    const out = new Map<number, CostBasis>();
    for (const [itemId, lots] of byItem) out.set(itemId, basisFromLots(lots));
    return out;
  }

  /** Keep `items.purchase_price` as the average paid per copy still held. */
  function recomputePurchasePrice(itemId: number): void {
    const lots = listLots(itemId);
    const basis = basisFromLots(lots);
    let average: number | null = null;
    if (basis.copiesWithCost > 0) {
      average = Math.round((basis.invested / basis.copiesWithCost) * 100) / 100;
    } else {
      // Nothing held any more, so fall back to what the copies cost when there
      // were some. An item sold down to nothing must not forget its own price.
      let spend = 0;
      let copies = 0;
      for (const lot of lots) {
        if (lot.unitCost === null) continue;
        spend += lot.unitCost * lot.quantity;
        copies += lot.quantity;
      }
      if (copies > 0) average = Math.round((spend / copies) * 100) / 100;
    }
    getDb().prepare("UPDATE items SET purchase_price = ? WHERE id = ?").run(average, itemId);
  }

  /** Make the item's quantity follow its lots, after a sale or an undo. */
  function syncQuantityFromLots(itemId: number): number {
    const held = listLots(itemId).reduce((n, lot) => n + lot.remaining, 0);
    getDb().prepare("UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?").run(held, new Date().toISOString(), itemId);
    recomputePurchasePrice(itemId);
    return held;
  }

  /** Items whose quantity and lots disagree. Empty is the only healthy answer. */
  function verifyLotInvariant(): number[] {
    return (
      getDb()
        .prepare(
          `SELECT i.id FROM items i
           WHERE i.quantity != COALESCE((SELECT SUM(a.remaining) FROM acquisitions a WHERE a.item_id = i.id), 0)`,
        )
        .all() as Array<{ id: number }>
    ).map((r) => r.id);
  }

  return {
    listLots,
    getLot,
    addLot,
    deleteLot,
    consumeFifo,
    recordSaleLots,
    listSaleLots,
    restoreForSale,
    reconcileToQuantity,
    costBasis,
    costBasisByItem,
    recomputePurchasePrice,
    syncQuantityFromLots,
    verifyLotInvariant,
  };
}
