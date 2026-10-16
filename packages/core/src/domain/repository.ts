import type { Ledger, AcquisitionInput } from "./acquisitions";
import type { DomainDb } from "./db";
import { decodeColumn, normalizeInput, parseJson, toRow } from "./normalize";
import { norm } from "../pricing/match";
import type { DomainSpec, Identification, ItemInput, ItemRecord, NormalizedItem, PriceSnapshot, PriceSummary } from "./spec";
import { columnOf } from "./spec";

/**
 * The item repository: everything that reads or writes the `items` table,
 * with the ledger kept in step and the Markdown mirror told about every
 * change. Domain columns come from the spec, so this is the same code for a
 * game, a comic, a watch or a bottle.
 */

export interface MirrorHooks<F extends object> {
  mirrorItem(item: ItemRecord<F>, opts?: { mayHaveOldName?: boolean }): void;
  unmirrorItem(id: number): void;
}

export interface ListOptions {
  search?: string;
  /** "" selects items with no location recorded. */
  location?: string;
  /** Field key -> value; enum and text fields match exactly, booleans as yes/no. */
  filters?: Record<string, string | boolean | null | undefined>;
  /** Include rows with no copies left (sold out). Default true. */
  includeSold?: boolean;
}

export type IntakeOutcome<F extends object> =
  | { result: "created"; item: ItemRecord<F> }
  | { result: "merged"; item: ItemRecord<F> }
  | { result: "ambiguous"; candidates: ItemRecord<F>[] };

interface SnapshotRow {
  id: number;
  item_id: number;
  fetched_at: string;
  summary: string;
}

export type Repository<F extends object, X extends object> = ReturnType<typeof createRepository<F, object, X, unknown>>;

export function createRepository<F extends object, S extends object, X extends object, Q>(ctx: {
  spec: DomainSpec<F, S, X, Q>;
  db: DomainDb;
  ledger: Ledger;
  mirror: MirrorHooks<F>;
}) {
  const { spec, db, ledger, mirror } = ctx;
  const getDb = db.getDb;
  const titleColumn = columnOf(spec.titleField);
  const columns = spec.fields.map((f) => columnOf(f.key));

  function rowToItem(row: Record<string, unknown>): ItemRecord<F> {
    const domain: Record<string, unknown> = {};
    for (const field of spec.fields) domain[field.key] = decodeColumn(field, row[columnOf(field.key)]);
    const photos = parseJson<unknown>(row.photos as string, []);
    return {
      id: row.id as number,
      quantity: row.quantity as number,
      purchasePrice: row.purchase_price as number | null,
      notes: row.notes as string | null,
      location: row.location as string | null,
      photos: Array.isArray(photos) ? photos.map(String) : [],
      referenceImageUrl: row.reference_image_url as string | null,
      accentColor: row.accent_color as string | null,
      externalIds: parseJson(row.external_ids as string, {}),
      identification: parseJson<Identification | null>(row.identification as string | null, null),
      manualValue: row.manual_value as number | null,
      manualPrices: parseJson(row.manual_prices as string, {}),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      ...(domain as F),
    };
  }

  // Items written inside a transaction are mirrored once it commits: a rolled
  // back import must not leave a Markdown file for an item that does not exist.
  const deferredMirror = new Map<number, boolean>();

  function touch(item: ItemRecord<F> | null, opts: { mayHaveOldName?: boolean } = {}): void {
    if (!item) return;
    const mayHaveOldName = opts.mayHaveOldName !== false;
    if (getDb().inTransaction) {
      deferredMirror.set(item.id, (deferredMirror.get(item.id) ?? false) || mayHaveOldName);
    } else {
      mirror.mirrorItem(item, opts);
    }
  }

  function flushDeferredMirror(): void {
    for (const [id, mayHaveOldName] of deferredMirror) {
      const item = getItem(id);
      if (item) mirror.mirrorItem(item, { mayHaveOldName });
    }
    deferredMirror.clear();
  }

  function discardDeferredMirror(): void {
    deferredMirror.clear();
  }

  /** Rewrite an item's Markdown file after something outside this module changed it. */
  function refreshMirror(itemId: number): void {
    touch(getItem(itemId));
  }

  function getItem(id: number): ItemRecord<F> | null {
    const row = getDb().prepare("SELECT * FROM items WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToItem(row) : null;
  }

  function insert(clean: NormalizedItem<F>): number {
    const now = new Date().toISOString();
    const row = { ...toRow(spec, clean), created_at: now, updated_at: now };
    const keys = Object.keys(row);
    const result = getDb()
      .prepare(`INSERT INTO items (${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`)
      .run(row);
    return Number(result.lastInsertRowid);
  }

  function createItem(input: ItemInput<F>): ItemRecord<F> {
    const clean = normalizeInput(spec, input);
    const id = insert(clean);
    const created = getItem(id)!;
    // Every copy has to belong to a lot, or the cost basis and the quantity
    // stop agreeing. An item added without a price gets a lot with an unknown cost.
    if (created.quantity > 0) {
      ledger.addLot(id, { quantity: created.quantity, unitCost: created.purchasePrice, acquiredAt: created.createdAt });
    }
    const item = getItem(id)!;
    touch(item, { mayHaveOldName: false });
    return item;
  }

  function updateItem(id: number, patch: ItemInput<F>): ItemRecord<F> | null {
    const existing = getItem(id);
    if (!existing) return null;
    let merged = normalizeInput(spec, { ...(existing as ItemInput<F>), ...patch } as ItemInput<F>);
    if (spec.hooks?.beforeUpdate) {
      merged = spec.hooks.beforeUpdate(existing, merged, { latestSnapshot: () => latestSnapshot(id) });
    }
    const row = { ...toRow(spec, merged), updated_at: new Date().toISOString(), id };
    const sets = Object.keys(row)
      .filter((k) => k !== "id")
      .map((k) => `${k} = @${k}`)
      .join(", ");
    getDb().prepare(`UPDATE items SET ${sets} WHERE id = @id`).run(row);
    if (merged.quantity !== existing.quantity) ledger.reconcileToQuantity(id, merged.quantity);
    if (patch.purchasePrice !== undefined) {
      // With one lot the purchase price is still something the owner sets
      // directly. With several it is an average of them, so the edit is
      // ignored and the recompute below puts the average back.
      const lots = ledger.listLots(id);
      if (lots.length === 1) getDb().prepare("UPDATE acquisitions SET unit_cost = ? WHERE id = ?").run(merged.purchasePrice, lots[0].id);
    }
    ledger.recomputePurchasePrice(id);
    const item = getItem(id);
    touch(item);
    return item;
  }

  function deleteItem(id: number): boolean {
    const gone = getDb().prepare("DELETE FROM items WHERE id = ?").run(id).changes > 0;
    if (gone) mirror.unmirrorItem(id);
    return gone;
  }

  /** Record another purchase of something already held. */
  function addAcquisition(itemId: number, input: AcquisitionInput): ItemRecord<F> | null {
    const run = getDb().transaction(() => {
      const item = getItem(itemId);
      if (!item) return null;
      if (spec.isUnique(item)) {
        throw new Error(`This ${spec.noun.singular} is one specific object, so a second copy of it is a separate ${spec.noun.singular}`);
      }
      const lot = ledger.addLot(itemId, input);
      getDb().prepare("UPDATE items SET quantity = quantity + ?, updated_at = ? WHERE id = ?").run(lot.quantity, new Date().toISOString(), itemId);
      ledger.recomputePurchasePrice(itemId);
      return getItem(itemId);
    });
    const updated = run();
    touch(updated);
    return updated;
  }

  /** Undo a purchase that was recorded by mistake. */
  function removeAcquisition(lotId: number): ItemRecord<F> | null {
    const run = getDb().transaction(() => {
      const lot = ledger.getLot(lotId);
      if (!lot) return null;
      const item = getItem(lot.itemId);
      if (!item) return null;
      ledger.deleteLot(lotId);
      getDb().prepare("UPDATE items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?").run(lot.remaining, new Date().toISOString(), lot.itemId);
      ledger.recomputePurchasePrice(lot.itemId);
      return getItem(lot.itemId);
    });
    const updated = run();
    touch(updated);
    return updated;
  }

  function listItems(opts: ListOptions = {}): ItemRecord<F>[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.search?.trim()) {
      const searchable = spec.fields.filter((f) => f.searchable && (f.type === "text" || f.type === "enum" || f.type === "list")).map((f) => columnOf(f.key));
      const cols = [...new Set([titleColumn, ...searchable, "notes", "location"])];
      // % and _ are LIKE wildcards; someone searching for "50%" means those
      // characters, not "match anything".
      where.push(`(${cols.map((c) => `${c} LIKE @q ESCAPE '\\'`).join(" OR ")})`);
      params.q = `%${opts.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    }
    if (opts.location !== undefined) {
      if (opts.location === "") where.push("(location IS NULL OR trim(location) = '')");
      else {
        where.push("location = @location");
        params.location = opts.location;
      }
    }
    for (const [key, value] of Object.entries(opts.filters ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      const field = spec.fields.find((f) => f.key === key);
      if (!field || !columns.includes(columnOf(key))) continue;
      const column = columnOf(key);
      const param = `f_${column}`;
      if (field.type === "boolean") {
        where.push(`${column} = @${param}`);
        params[param] = value === true || value === "1" || value === "true" ? 1 : 0;
      } else {
        where.push(`${column} = @${param}`);
        params[param] = String(value);
      }
    }
    if (opts.includeSold === false) where.push("quantity > 0");
    const sql = `SELECT * FROM items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC, id DESC`;
    return (getDb().prepare(sql).all(params) as Array<Record<string, unknown>>).map(rowToItem);
  }

  function countItems(): number {
    return (getDb().prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
  }

  /** Every location in use, with how many items are kept there. */
  function listLocations(): Array<{ location: string; items: number }> {
    return getDb()
      .prepare(
        `SELECT location, COUNT(*) AS items FROM items
         WHERE location IS NOT NULL AND trim(location) != '' AND quantity > 0
         GROUP BY location ORDER BY location COLLATE NOCASE`,
      )
      .all() as Array<{ location: string; items: number }>;
  }

  function sameValue(a: unknown, b: unknown): boolean {
    if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "";
    if (b === null || b === undefined || b === "") return false;
    if (typeof a === "string" || typeof b === "string") return norm(a) === norm(b);
    return a === b;
  }

  /** Whether two records name the same thing by the spec's identity keys. */
  function sameIdentity(a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]): boolean {
    return keys.every((key) => sameValue(a[key], b[key]));
  }

  /**
   * Rows that look like the same thing as the input: the title agrees and so
   * does every identity key. Whether they may merge is decided by the caller,
   * since a unique object never merges however alike it looks.
   */
  function findSimilar(input: Partial<NormalizedItem<F>> | ItemRecord<F>): ItemRecord<F>[] {
    const values = input as Record<string, unknown>;
    const title = String(values[spec.titleField] ?? "").trim().toLowerCase();
    if (!title) return [];
    const rows = getDb()
      .prepare(`SELECT * FROM items WHERE lower(trim(${titleColumn})) = ? ORDER BY updated_at DESC, id DESC`)
      .all(title) as Array<Record<string, unknown>>;
    return rows.map(rowToItem).filter((c) => sameIdentity(c as Record<string, unknown>, values, spec.identity.keys));
  }

  /** Two rows describing the same object: identity keys, the unique/stackable side, and for unique objects the keys that make it that object. */
  function isSameItem(existing: ItemRecord<F>, input: NormalizedItem<F>): boolean {
    const a = existing as unknown as Record<string, unknown>;
    const b = input as unknown as Record<string, unknown>;
    if (!sameValue(a[spec.titleField], b[spec.titleField])) return false;
    if (!sameIdentity(a, b, spec.identity.keys)) return false;
    const unique = spec.isUnique(input);
    if (spec.isUnique(existing) !== unique) return false;
    if (!unique) return true;
    return sameIdentity(a, b, spec.identity.uniqueKeys ?? []);
  }

  /**
   * Add an item in one transaction, deciding for itself whether it joins a
   * stack already held: a unique object always gets its own row; a fungible
   * one joins the single row that matches, or stops when several could.
   */
  function intakeItem(input: ItemInput<F>): IntakeOutcome<F> {
    const clean = normalizeInput(spec, input);
    const run = getDb().transaction((): IntakeOutcome<F> => {
      if (spec.isUnique(clean)) return { result: "created", item: createItem(input) };
      const candidates = findSimilar(clean).filter((c) => !spec.isUnique(c));
      if (candidates.length > 1) return { result: "ambiguous", candidates };
      if (candidates.length === 1) {
        const stack = candidates[0];
        const copies = clean.quantity || 1;
        // The copies being merged in are their own purchase at their own price;
        // folding them into the existing row's price would lose what they cost.
        ledger.addLot(stack.id, { quantity: copies, unitCost: clean.purchasePrice });
        const patch: ItemInput<F> = { quantity: stack.quantity + copies } as ItemInput<F>;
        if (stack.photos.length === 0 && clean.photos.length) {
          patch.photos = clean.photos;
          patch.accentColor = clean.accentColor;
        }
        return { result: "merged", item: updateItem(stack.id, patch)! };
      }
      return { result: "created", item: createItem(input) };
    });
    try {
      const outcome = run();
      flushDeferredMirror();
      return outcome;
    } catch (e) {
      discardDeferredMirror();
      throw e;
    }
  }

  function rowToSnapshot(r: SnapshotRow): PriceSnapshot<X> {
    return { id: r.id, itemId: r.item_id, fetchedAt: r.fetched_at, summary: JSON.parse(r.summary) as PriceSummary<X> };
  }

  function addSnapshot(itemId: number, summary: PriceSummary<X>): PriceSnapshot<X> {
    const result = getDb().prepare("INSERT INTO price_snapshots (item_id, fetched_at, summary) VALUES (?, ?, ?)").run(itemId, summary.fetchedAt, JSON.stringify(summary));
    touch(getItem(itemId));
    return { id: Number(result.lastInsertRowid), itemId, fetchedAt: summary.fetchedAt, summary };
  }

  function listSnapshots(itemId: number, limit = 50): PriceSnapshot<X>[] {
    return (
      getDb().prepare("SELECT * FROM price_snapshots WHERE item_id = ? ORDER BY fetched_at DESC, id DESC LIMIT ?").all(itemId, limit) as SnapshotRow[]
    ).map(rowToSnapshot);
  }

  function latestSnapshot(itemId: number): PriceSnapshot<X> | null {
    return listSnapshots(itemId, 1)[0] ?? null;
  }

  /** Every snapshot, oldest first (for the portfolio history). */
  function allSnapshots(): PriceSnapshot<X>[] {
    return (getDb().prepare("SELECT * FROM price_snapshots ORDER BY fetched_at ASC, id ASC").all() as SnapshotRow[]).map(rowToSnapshot);
  }

  /** Latest snapshot for every item in one query. */
  function latestSnapshotsByItem(): Map<number, PriceSnapshot<X>> {
    const rows = getDb()
      .prepare(
        `SELECT s.* FROM price_snapshots s
         JOIN (SELECT item_id, MAX(id) AS max_id FROM price_snapshots GROUP BY item_id) m ON m.max_id = s.id`,
      )
      .all() as SnapshotRow[];
    const map = new Map<number, PriceSnapshot<X>>();
    for (const r of rows) map.set(r.item_id, rowToSnapshot(r));
    return map;
  }

  return {
    rowToItem,
    getItem,
    createItem,
    updateItem,
    deleteItem,
    addAcquisition,
    removeAcquisition,
    listItems,
    countItems,
    listLocations,
    findSimilar,
    isSameItem,
    intakeItem,
    addSnapshot,
    listSnapshots,
    latestSnapshot,
    allSnapshots,
    latestSnapshotsByItem,
    flushDeferredMirror,
    discardDeferredMirror,
    refreshMirror,
    normalize: (input: ItemInput<F>) => normalizeInput(spec, input),
  };
}
