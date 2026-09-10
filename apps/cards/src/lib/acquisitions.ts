import { getDb } from "./db";

/**
 * Where each copy of a card came from and what it cost.
 *
 * A card's cost used to be one number on the card row, which is only true if
 * every copy cost the same. Each purchase is now its own lot, sales consume
 * lots oldest first, and `cards.purchase_price` becomes a weighted average of
 * what is still held — derived from these rows rather than owned directly.
 *
 * A null `unitCost` is a real state, not a missing value: plenty of cards
 * arrive in a bulk lot, as a gift, or from a childhood shoebox. Those copies
 * are counted separately rather than being priced at zero, which would read as
 * a total profit.
 *
 * This module deliberately imports nothing from the card repository: it is the
 * data layer under it, and `cards.ts` owns the transaction and the Markdown
 * mirror around these calls.
 */

export interface Acquisition {
  id: number;
  cardId: number;
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

interface LotRow {
  id: number;
  card_id: number;
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
    cardId: r.card_id,
    quantity: r.quantity,
    remaining: r.remaining,
    unitCost: r.unit_cost,
    acquiredAt: r.acquired_at,
    source: r.source,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

/** Oldest first, which is also the order sales consume them in. */
export function listLots(cardId: number): Acquisition[] {
  return (
    getDb()
      .prepare("SELECT * FROM acquisitions WHERE card_id = ? ORDER BY acquired_at, id")
      .all(cardId) as LotRow[]
  ).map(rowToLot);
}

export function getLot(id: number): Acquisition | null {
  const row = getDb().prepare("SELECT * FROM acquisitions WHERE id = ?").get(id) as LotRow | undefined;
  return row ? rowToLot(row) : null;
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Record a purchase. Returns the lot as stored. */
export function addLot(cardId: number, input: AcquisitionInput = {}): Acquisition {
  const quantity = Math.max(1, Math.floor(Number(input.quantity ?? 1)) || 1);
  const when = input.acquiredAt ? new Date(input.acquiredAt) : new Date();
  if (Number.isNaN(when.getTime())) throw new Error("Acquisition date is not a valid date");
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO acquisitions (card_id, quantity, remaining, unit_cost, acquired_at, source, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cardId,
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
 * copies sold out of it are part of a sale's cost basis, and deleting it would
 * rewrite money that has already changed hands.
 */
export function deleteLot(id: number): boolean {
  const lot = getLot(id);
  if (!lot) return false;
  if (lot.remaining !== lot.quantity) {
    throw new Error("Copies from this purchase have already been sold, so it cannot be removed");
  }
  return getDb().prepare("DELETE FROM acquisitions WHERE id = ?").run(id).changes > 0;
}

export interface Consumed {
  acquisitionId: number | null;
  quantity: number;
  unitCost: number | null;
}

/**
 * Take `quantity` copies from the oldest lots first.
 *
 * If the lots cannot cover it — which should not happen while the invariant
 * holds, but must not lose a sale if it ever does — the shortfall is recorded
 * against no lot at all, with an unknown cost. That is the honest description
 * of a copy whose origin nothing knows.
 */
export function consumeFifo(cardId: number, quantity: number): { lots: Consumed[]; unitCost: number | null } {
  const db = getDb();
  const lots: Consumed[] = [];
  let left = quantity;
  for (const lot of listLots(cardId)) {
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

export function recordSaleLots(saleId: number, lots: Consumed[]): void {
  const insert = getDb().prepare("INSERT INTO sale_lots (sale_id, acquisition_id, quantity, unit_cost) VALUES (?, ?, ?, ?)");
  for (const lot of lots) insert.run(saleId, lot.acquisitionId, lot.quantity, lot.unitCost);
}

export function listSaleLots(saleId: number): Consumed[] {
  return (
    getDb().prepare("SELECT acquisition_id, quantity, unit_cost FROM sale_lots WHERE sale_id = ? ORDER BY id").all(saleId) as Array<{
      acquisition_id: number | null;
      quantity: number;
      unit_cost: number | null;
    }>
  ).map((r) => ({ acquisitionId: r.acquisition_id, quantity: r.quantity, unitCost: r.unit_cost }));
}

/**
 * Put the copies a sale took back where they came from. A lot that has since
 * gone is recreated from what the sale recorded, so undoing a sale never costs
 * the basis of the copies it returns.
 */
export function restoreForSale(cardId: number, saleId: number): void {
  const db = getDb();
  for (const lot of listSaleLots(saleId)) {
    const target = lot.acquisitionId === null ? null : getLot(lot.acquisitionId);
    if (target) db.prepare("UPDATE acquisitions SET remaining = remaining + ? WHERE id = ?").run(lot.quantity, target.id);
    else addLot(cardId, { quantity: lot.quantity, unitCost: lot.unitCost, source: "restored" });
  }
}

/**
 * Make the lots add up to a quantity that was set directly, which the edit form
 * allows. More copies than the lots know about become a lot with an unknown
 * cost; fewer are taken off the newest lots first, on the grounds that an
 * unexplained reduction is most likely undoing a recent addition, and taking
 * them off the oldest would misprice the copies actually kept.
 */
export function reconcileToQuantity(cardId: number, quantity: number): void {
  const db = getDb();
  const lots = listLots(cardId);
  const held = lots.reduce((n, lot) => n + lot.remaining, 0);
  if (held === quantity) return;

  if (quantity > held) {
    addLot(cardId, { quantity: quantity - held, unitCost: null, source: "adjustment" });
    return;
  }

  let over = held - quantity;
  // Newest first.
  for (const lot of [...lots].reverse()) {
    if (over <= 0) break;
    if (lot.remaining <= 0) continue;
    const take = Math.min(lot.remaining, over);
    const remaining = lot.remaining - take;
    // Shrink what the lot claims to have brought in by the same amount, so the
    // copies it records as sold stay exactly as they were.
    const size = lot.quantity - take;
    if (size <= 0) db.prepare("DELETE FROM acquisitions WHERE id = ?").run(lot.id);
    else db.prepare("UPDATE acquisitions SET quantity = ?, remaining = ? WHERE id = ?").run(size, remaining, lot.id);
    over -= take;
  }
}

/** What the copies still held cost, and how many of them nothing knows the cost of. */
export function costBasis(cardId: number): CostBasis {
  return basisFromLots(listLots(cardId));
}

function basisFromLots(lots: Acquisition[]): CostBasis {
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

/** Cost basis for every card at once, for the portfolio figures. */
export function costBasisByCard(): Map<number, CostBasis> {
  const rows = getDb()
    .prepare("SELECT * FROM acquisitions WHERE remaining > 0 ORDER BY card_id, acquired_at, id")
    .all() as LotRow[];
  const byCard = new Map<number, Acquisition[]>();
  for (const row of rows) {
    const lot = rowToLot(row);
    const list = byCard.get(lot.cardId);
    if (list) list.push(lot);
    else byCard.set(lot.cardId, [lot]);
  }
  const out = new Map<number, CostBasis>();
  for (const [cardId, lots] of byCard) out.set(cardId, basisFromLots(lots));
  return out;
}

/**
 * Keep `cards.purchase_price` as the average paid per copy still held. It is a
 * derived figure now rather than something the card owns, but every price
 * source, the CSV columns and the Markdown front matter still read it.
 */
export function recomputePurchasePrice(cardId: number): void {
  const lots = listLots(cardId);
  const basis = basisFromLots(lots);
  let average: number | null = null;
  if (basis.copiesWithCost > 0) {
    average = Math.round((basis.invested / basis.copiesWithCost) * 100) / 100;
  } else {
    // Nothing is held any more, so fall back to what the copies cost when there
    // were some. A card sold down to nothing must not forget its own price.
    let spend = 0;
    let copies = 0;
    for (const lot of lots) {
      if (lot.unitCost === null) continue;
      spend += lot.unitCost * lot.quantity;
      copies += lot.quantity;
    }
    if (copies > 0) average = Math.round((spend / copies) * 100) / 100;
  }
  getDb().prepare("UPDATE cards SET purchase_price = ? WHERE id = ?").run(average, cardId);
}

/**
 * Make the card's quantity follow its lots. Used after a sale or an undo, where
 * the lots are the thing that changed — the opposite direction to
 * `reconcileToQuantity`, which is for a count typed into the edit form.
 */
export function syncQuantityFromLots(cardId: number): number {
  const held = listLots(cardId).reduce((n, lot) => n + lot.remaining, 0);
  getDb().prepare("UPDATE cards SET quantity = ?, updated_at = ? WHERE id = ?").run(held, new Date().toISOString(), cardId);
  recomputePurchasePrice(cardId);
  return held;
}

/** Cards whose quantity and lots disagree. Empty is the only healthy answer. */
export function verifyLotInvariant(): number[] {
  return (
    getDb()
      .prepare(
        `SELECT c.id FROM cards c
         WHERE c.quantity != COALESCE((SELECT SUM(a.remaining) FROM acquisitions a WHERE a.card_id = c.id), 0)`,
      )
      .all() as Array<{ id: number }>
  ).map((r) => r.id);
}
