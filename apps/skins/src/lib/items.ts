import { getDb } from "./db";
import type { AppliedSticker, Category, Exterior, ItemInput, ItemRecord, PriceSnapshot, PriceSummary, Rarity } from "./types";
import { CATEGORIES, EXTERIORS, RARITIES, exteriorForFloat, isStackable } from "./types";
import {
  addLot,
  costBasisByItem,
  deleteLot,
  getLot,
  listLots,
  reconcileToQuantity,
  recomputePurchasePrice,
  type AcquisitionInput,
} from "./acquisitions";
import { mirrorItem, unmirrorItem } from "./markdown/mirror";

interface ItemRow {
  id: number;
  market_hash_name: string;
  category: string;
  stackable: number;
  weapon: string | null;
  finish: string | null;
  exterior: string | null;
  rarity: string | null;
  collection: string | null;
  stattrak: number;
  souvenir: number;
  float_value: number | null;
  paint_seed: number | null;
  paint_index: number | null;
  name_tag: string | null;
  quantity: number;
  purchase_price: number | null;
  asset_id: string | null;
  inspect_link: string | null;
  tradable_after: string | null;
  storage_unit: string | null;
  image_url: string | null;
  notes: string | null;
  external_ids: string;
  manual_price: number | null;
  created_at: string;
  updated_at: string;
}

interface StickerRow {
  item_id: number;
  slot: number;
  name: string;
  market_hash_name: string | null;
  wear: number | null;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function rowToItem(row: ItemRow, stickers: AppliedSticker[]): ItemRecord {
  return {
    id: row.id,
    marketHashName: row.market_hash_name,
    category: row.category as Category,
    stackable: row.stackable !== 0,
    weapon: row.weapon,
    finish: row.finish,
    exterior: row.exterior as Exterior | null,
    rarity: row.rarity as Rarity | null,
    collection: row.collection,
    stattrak: row.stattrak !== 0,
    souvenir: row.souvenir !== 0,
    floatValue: row.float_value,
    paintSeed: row.paint_seed,
    paintIndex: row.paint_index,
    nameTag: row.name_tag,
    quantity: row.quantity,
    purchasePrice: row.purchase_price,
    assetId: row.asset_id,
    inspectLink: row.inspect_link,
    tradableAfter: row.tradable_after,
    storageUnit: row.storage_unit,
    imageUrl: row.image_url,
    notes: row.notes,
    externalIds: parseJson(row.external_ids, {}),
    manualPrice: row.manual_price,
    stickers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

/** Only http(s) URLs may be stored for rendering as links or images. */
const httpUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

/**
 * An inspect link is `steam://rungame/...`, which is not an http URL and must
 * not be turned into one. It is stored verbatim but only when it has the shape
 * the game actually uses, so nothing else can be smuggled into an href.
 */
const inspectUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  return /^steam:\/\/rungame\/730\/\d+\/[+ ]csgo_econ_action_preview[ %][SM]\d+A\d+D\d+$/.test(s) ? s : null;
};

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A float is only meaningful inside 0..1; anything else is not a wear value. */
const floatValue = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 && n <= 1 ? n : null;
};

/** An ISO timestamp, or null when the input is not a date at all. */
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function normalizeStickers(input: unknown): AppliedSticker[] {
  if (!Array.isArray(input)) return [];
  const out: AppliedSticker[] = [];
  const seen = new Set<number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Partial<AppliedSticker>;
    const name = str(s.name);
    if (!name) continue;
    const slot = Math.max(0, Math.floor(num(s.slot) ?? out.length));
    if (seen.has(slot)) continue;
    seen.add(slot);
    const wear = num(s.wear);
    out.push({
      slot,
      name,
      marketHashName: str(s.marketHashName),
      wear: wear !== null && wear >= 0 && wear <= 1 ? wear : null,
    });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

export type NormalizedItem = Omit<ItemRecord, "id" | "createdAt" | "updatedAt">;

/** Validate and normalize client input; throws on missing or unknown values. */
export function normalizeInput(input: ItemInput): NormalizedItem {
  const marketHashName = str(input.marketHashName);
  if (!marketHashName) throw new Error("An item needs its market hash name");
  // Object.hasOwn, not `in`: "constructor" and "toString" are on every object's
  // prototype, and would otherwise pass as a category or a rarity.
  const category = (str(input.category) ?? "other") as Category;
  if (!Object.hasOwn(CATEGORIES, category)) throw new Error(`Unknown category: ${input.category}`);
  const rarity = str(input.rarity) as Rarity | null;
  if (rarity !== null && !Object.hasOwn(RARITIES, rarity)) throw new Error(`Unknown rarity: ${input.rarity}`);

  const stackable = isStackable(category);
  const float = floatValue(input.floatValue);

  // The float is what the exterior *is*: the tier printed in the item's name is
  // derived from it, so where both are given the float decides and a
  // contradicting tier is not stored.
  let exterior = str(input.exterior) as Exterior | null;
  if (exterior !== null && !Object.hasOwn(EXTERIORS, exterior)) throw new Error(`Unknown exterior: ${input.exterior}`);
  if (float !== null) exterior = exteriorForFloat(float);

  // A unique object is one object. Letting a quantity of 3 through would put
  // three copies of one float and one pattern in the ledger.
  const quantity = stackable ? Math.max(0, Math.floor(num(input.quantity) ?? 1)) : Math.min(1, Math.max(0, Math.floor(num(input.quantity) ?? 1)));

  return {
    marketHashName,
    category,
    stackable,
    weapon: str(input.weapon),
    finish: str(input.finish),
    exterior,
    rarity,
    collection: str(input.collection),
    stattrak: Boolean(input.stattrak),
    souvenir: Boolean(input.souvenir),
    floatValue: float,
    paintSeed: num(input.paintSeed) === null ? null : Math.floor(num(input.paintSeed)!),
    paintIndex: num(input.paintIndex) === null ? null : Math.floor(num(input.paintIndex)!),
    nameTag: str(input.nameTag),
    quantity,
    purchasePrice: num(input.purchasePrice),
    assetId: str(input.assetId),
    inspectLink: inspectUrl(input.inspectLink),
    tradableAfter: isoDate(input.tradableAfter),
    storageUnit: str(input.storageUnit)?.slice(0, 120) ?? null,
    imageUrl: httpUrl(input.imageUrl),
    notes: str(input.notes),
    externalIds: Object.fromEntries(
      Object.entries(input.externalIds ?? {}).filter(([, v]) => str(v)),
    ) as Record<string, string>,
    manualPrice: num(input.manualPrice),
    stickers: normalizeStickers(input.stickers),
  };
}

/**
 * Items written inside a transaction are mirrored once it commits: a rolled
 * back import must not leave a Markdown file for an item that does not exist.
 */
/** Item id -> whether it might already be filed under a different name. */
const deferredMirror = new Map<number, boolean>();

function touch(item: ItemRecord | null, opts: { mayHaveOldName?: boolean } = {}): void {
  if (!item) return;
  const mayHaveOldName = opts.mayHaveOldName !== false;
  if (getDb().inTransaction) {
    // Keep the hint: importing a thousand new items must not make a thousand
    // passes over the folder looking for files that cannot exist.
    deferredMirror.set(item.id, (deferredMirror.get(item.id) ?? false) || mayHaveOldName);
  } else {
    mirrorItem(item, opts);
  }
}

/**
 * Write the Markdown files for everything a transaction touched. Callers that
 * open their own transaction must call this after it commits, and
 * `discardDeferredMirror` if it rolls back.
 */
export function flushDeferredMirror(): void {
  for (const [id, mayHaveOldName] of deferredMirror) {
    const item = getItem(id);
    if (item) mirrorItem(item, { mayHaveOldName });
  }
  deferredMirror.clear();
}

/** Rewrite an item's Markdown file after something outside this module changed it. */
export function refreshMirror(itemId: number): void {
  touch(getItem(itemId));
}

export function discardDeferredMirror(): void {
  deferredMirror.clear();
}

function writeStickers(itemId: number, stickers: AppliedSticker[]): void {
  const db = getDb();
  db.prepare("DELETE FROM item_stickers WHERE item_id = ?").run(itemId);
  const insert = db.prepare(
    "INSERT INTO item_stickers (item_id, slot, name, market_hash_name, wear) VALUES (?, ?, ?, ?, ?)",
  );
  for (const s of stickers) insert.run(itemId, s.slot, s.name, s.marketHashName, s.wear);
}

function readStickers(itemId: number): AppliedSticker[] {
  return (
    getDb()
      .prepare("SELECT * FROM item_stickers WHERE item_id = ? ORDER BY slot")
      .all(itemId) as StickerRow[]
  ).map((r) => ({ slot: r.slot, name: r.name, marketHashName: r.market_hash_name, wear: r.wear }));
}

export function createItem(input: ItemInput): ItemRecord {
  const i = normalizeInput(input);
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO items (market_hash_name, category, stackable, weapon, finish, exterior, rarity, collection,
        stattrak, souvenir, float_value, paint_seed, paint_index, name_tag, quantity, purchase_price,
        asset_id, inspect_link, tradable_after, storage_unit, image_url, notes, external_ids, manual_price,
        created_at, updated_at)
       VALUES (@marketHashName, @category, @stackable, @weapon, @finish, @exterior, @rarity, @collection,
        @stattrak, @souvenir, @floatValue, @paintSeed, @paintIndex, @nameTag, @quantity, @purchasePrice,
        @assetId, @inspectLink, @tradableAfter, @storageUnit, @imageUrl, @notes, @externalIds, @manualPrice,
        @now, @now)`,
    )
    .run({
      ...i,
      stackable: i.stackable ? 1 : 0,
      stattrak: i.stattrak ? 1 : 0,
      souvenir: i.souvenir ? 1 : 0,
      externalIds: JSON.stringify(i.externalIds),
      now,
    });
  const id = Number(result.lastInsertRowid);
  writeStickers(id, i.stickers);
  const created = getItem(id)!;
  // Every copy has to belong to a lot, or the cost basis and the quantity stop
  // agreeing. An item added without a price gets a lot with an unknown cost.
  if (created.quantity > 0) {
    addLot(created.id, { quantity: created.quantity, unitCost: created.purchasePrice, acquiredAt: created.createdAt });
  }
  const item = getItem(created.id)!;
  touch(item, { mayHaveOldName: false });
  return item;
}

export function updateItem(id: number, patch: Partial<ItemInput>): ItemRecord | null {
  const existing = getItem(id);
  if (!existing) return null;
  const merged = normalizeInput({
    ...existing,
    ...patch,
    marketHashName: patch.marketHashName ?? existing.marketHashName,
  });
  getDb()
    .prepare(
      `UPDATE items SET market_hash_name=@marketHashName, category=@category, stackable=@stackable, weapon=@weapon,
        finish=@finish, exterior=@exterior, rarity=@rarity, collection=@collection, stattrak=@stattrak,
        souvenir=@souvenir, float_value=@floatValue, paint_seed=@paintSeed, paint_index=@paintIndex,
        name_tag=@nameTag, quantity=@quantity, purchase_price=@purchasePrice, asset_id=@assetId,
        inspect_link=@inspectLink, tradable_after=@tradableAfter, storage_unit=@storageUnit, image_url=@imageUrl,
        notes=@notes, external_ids=@externalIds, manual_price=@manualPrice, updated_at=@now
       WHERE id=@id`,
    )
    .run({
      ...merged,
      id,
      stackable: merged.stackable ? 1 : 0,
      stattrak: merged.stattrak ? 1 : 0,
      souvenir: merged.souvenir ? 1 : 0,
      externalIds: JSON.stringify(merged.externalIds),
      now: new Date().toISOString(),
    });
  if (patch.stickers !== undefined) writeStickers(id, merged.stickers);
  if (merged.quantity !== existing.quantity) reconcileToQuantity(id, merged.quantity);
  if (patch.purchasePrice !== undefined) {
    // With one lot the purchase price is still something the owner sets
    // directly. With several it is an average of them, so the edit is ignored
    // and the recompute below puts the average back.
    const lots = listLots(id);
    if (lots.length === 1) {
      getDb().prepare("UPDATE acquisitions SET unit_cost = ? WHERE id = ?").run(merged.purchasePrice, lots[0].id);
    }
  }
  recomputePurchasePrice(id);
  const item = getItem(id);
  touch(item);
  return item;
}

/** Record another purchase of an item already held. */
export function addAcquisition(itemId: number, input: AcquisitionInput): ItemRecord | null {
  const run = getDb().transaction(() => {
    const item = getItem(itemId);
    if (!item) return null;
    if (!item.stackable) {
      throw new Error("This item is one specific object, so a second copy of it is a separate item");
    }
    const lot = addLot(itemId, input);
    getDb().prepare("UPDATE items SET quantity = quantity + ?, updated_at = ? WHERE id = ?").run(lot.quantity, new Date().toISOString(), itemId);
    recomputePurchasePrice(itemId);
    return getItem(itemId);
  });
  const updated = run();
  touch(updated);
  return updated;
}

/** Undo a purchase that was recorded by mistake. */
export function removeAcquisition(lotId: number): ItemRecord | null {
  const run = getDb().transaction(() => {
    const lot = getLot(lotId);
    if (!lot) return null;
    const item = getItem(lot.itemId);
    if (!item) return null;
    deleteLot(lotId);
    getDb()
      .prepare("UPDATE items SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?")
      .run(lot.remaining, new Date().toISOString(), lot.itemId);
    recomputePurchasePrice(lot.itemId);
    return getItem(lot.itemId);
  });
  const updated = run();
  touch(updated);
  return updated;
}

export function getItem(id: number): ItemRecord | null {
  const row = getDb().prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
  return row ? rowToItem(row, readStickers(row.id)) : null;
}

/** The row holding one specific Steam object, if this inventory has seen it. */
export function findByAssetId(assetId: string): ItemRecord | null {
  const row = getDb().prepare("SELECT * FROM items WHERE asset_id = ?").get(assetId) as ItemRow | undefined;
  return row ? rowToItem(row, readStickers(row.id)) : null;
}

/**
 * The stackable row for a name, if there is one.
 *
 * Steam's market hash name is exact and canonical — it already carries the
 * wear tier, the StatTrak prefix and the Souvenir marking — so matching is
 * equality, with none of the fuzzy set-and-number reasoning a card needs.
 */
export function findStack(marketHashName: string): ItemRecord | null {
  const row = getDb()
    .prepare(
      // Timestamps are only millisecond-resolution, so two items saved in the
      // same tick would otherwise come back in whatever order SQLite fancied.
      "SELECT * FROM items WHERE stackable = 1 AND market_hash_name = ? ORDER BY updated_at DESC, id DESC",
    )
    .get(marketHashName) as ItemRow | undefined;
  return row ? rowToItem(row, readStickers(row.id)) : null;
}

/** Every row carrying this exact name, newest first. */
export function listByMarketHashName(marketHashName: string): ItemRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM items WHERE market_hash_name = ? ORDER BY updated_at DESC, id DESC")
    .all(marketHashName) as ItemRow[];
  const stickers = stickersByItem(rows.map((r) => r.id));
  return rows.map((r) => rowToItem(r, stickers.get(r.id) ?? []));
}

export type IntakeOutcome =
  | { result: "created"; item: ItemRecord }
  | { result: "merged"; item: ItemRecord }
  | { result: "updated"; item: ItemRecord };

/**
 * Add an item in one transaction, deciding for itself whether it joins
 * something already held.
 *
 * Three cases, and the order matters. An asset id names one object in one Steam
 * account, so seeing it again is the same object re-read, never a second one.
 * Failing that, a stackable item joins its stack. Anything else — a weapon, a
 * knife, a pair of gloves — is a unique object with its own float and pattern,
 * and gets its own row even when an identical name is already there.
 */
export function intakeItem(input: ItemInput): IntakeOutcome {
  const clean = normalizeInput(input);
  const run = getDb().transaction((): IntakeOutcome => {
    if (clean.assetId) {
      const same = findByAssetId(clean.assetId);
      if (same) return { result: "updated", item: updateItem(same.id, input)! };
    }
    if (clean.stackable) {
      const stack = findStack(clean.marketHashName);
      if (stack) {
        const copies = clean.quantity || 1;
        // The copies being merged in are their own purchase at their own price;
        // folding them into the existing row's price would lose what they cost.
        addLot(stack.id, { quantity: copies, unitCost: clean.purchasePrice });
        const patch: Partial<ItemInput> = { quantity: stack.quantity + copies };
        if (!stack.imageUrl && clean.imageUrl) patch.imageUrl = clean.imageUrl;
        return { result: "merged", item: updateItem(stack.id, patch)! };
      }
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

export type SyncOutcome =
  | { result: "created"; item: ItemRecord }
  | { result: "updated"; item: ItemRecord }
  | { result: "increased"; item: ItemRecord; by: number }
  | { result: "decreased"; item: ItemRecord; by: number }
  | { result: "unchanged"; item: ItemRecord };

/**
 * Take an item from a reading of a whole inventory, where the count is the
 * truth rather than an addition.
 *
 * This is the difference between "I bought three more cases" and "Steam says I
 * have twenty". `intakeItem` is right for the first and catastrophic for the
 * second: reading the same inventory twice would double every stack, and a
 * whole-inventory import is exactly the thing people run more than once.
 *
 * So a stack is reconciled to what the source says. More than is held is a
 * purchase nobody recorded, and gets a lot with an unknown cost; fewer means
 * copies left by some route this app never saw, and the newest lots give them
 * up. A unique object needs none of this — its asset id already says whether
 * it is the same object — so it is simply updated.
 */
export function syncFromInventory(input: ItemInput): SyncOutcome {
  const clean = normalizeInput(input);
  const run = getDb().transaction((): SyncOutcome => {
    if (clean.assetId) {
      const same = findByAssetId(clean.assetId);
      if (same) return { result: "updated", item: updateItem(same.id, input)! };
    }
    if (!clean.stackable) return { result: "created", item: createItem(input) };

    const stack = findStack(clean.marketHashName);
    if (!stack) return { result: "created", item: createItem(input) };

    const wanted = clean.quantity;
    if (wanted === stack.quantity) return { result: "unchanged", item: stack };
    if (wanted > stack.quantity) {
      addLot(stack.id, { quantity: wanted - stack.quantity, unitCost: null, source: "steam" });
      return { result: "increased", item: updateItem(stack.id, { quantity: wanted })!, by: wanted - stack.quantity };
    }
    return { result: "decreased", item: updateItem(stack.id, { quantity: wanted })!, by: stack.quantity - wanted };
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

/**
 * Unique objects this app holds that a reading of the inventory did not
 * mention — traded away, sold elsewhere, or moved into a storage unit, which
 * the public endpoint does not cover.
 *
 * Reported rather than removed. This app's whole point is not losing the record
 * of what something cost, and "Steam did not mention it" is far too weak a
 * reason to throw that away.
 */
export function itemsMissingFrom(assetIds: Iterable<string>): ItemRecord[] {
  const seen = new Set(assetIds);
  return listItems().filter((item) => item.assetId !== null && item.quantity > 0 && !seen.has(item.assetId));
}

export function deleteItem(id: number): boolean {
  const gone = getDb().prepare("DELETE FROM items WHERE id = ?").run(id).changes > 0;
  if (gone) unmirrorItem(id);
  return gone;
}

export interface ListOptions {
  category?: Category;
  exterior?: Exterior;
  rarity?: Rarity;
  stattrak?: boolean;
  search?: string;
  storageUnit?: string;
  /** Only items whose trade lock has not lifted yet. */
  lockedOnly?: boolean;
}

export function listItems(opts: ListOptions = {}): ItemRecord[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.category) {
    where.push("category = @category");
    params.category = opts.category;
  }
  if (opts.exterior) {
    where.push("exterior = @exterior");
    params.exterior = opts.exterior;
  }
  if (opts.rarity) {
    where.push("rarity = @rarity");
    params.rarity = opts.rarity;
  }
  if (opts.stattrak !== undefined) {
    where.push("stattrak = @stattrak");
    params.stattrak = opts.stattrak ? 1 : 0;
  }
  if (opts.search?.trim()) {
    // % and _ are LIKE wildcards; someone searching for "AWP_Dragon" means
    // those characters, not "match anything".
    const clauses = ["market_hash_name", "weapon", "finish", "collection", "notes", "name_tag", "storage_unit"].map(
      (c) => `${c} LIKE @q ESCAPE '\\'`,
    );
    where.push(`(${clauses.join(" OR ")})`);
    params.q = `%${opts.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
  }
  if (opts.storageUnit !== undefined) {
    if (opts.storageUnit === "") where.push("(storage_unit IS NULL OR trim(storage_unit) = '')");
    else {
      where.push("storage_unit = @storageUnit");
      params.storageUnit = opts.storageUnit;
    }
  }
  if (opts.lockedOnly) {
    where.push("tradable_after IS NOT NULL AND tradable_after > @now");
    params.now = new Date().toISOString();
  }
  const sql = `SELECT * FROM items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC, id DESC`;
  const rows = getDb().prepare(sql).all(params) as ItemRow[];
  const stickers = stickersByItem(rows.map((r) => r.id));
  return rows.map((r) => rowToItem(r, stickers.get(r.id) ?? []));
}

/**
 * Stickers for many items in one query. Reading them per row turns a listing of
 * four hundred items into four hundred round trips.
 */
function stickersByItem(ids: number[]): Map<number, AppliedSticker[]> {
  const out = new Map<number, AppliedSticker[]>();
  if (ids.length === 0) return out;
  const rows = getDb()
    .prepare(`SELECT * FROM item_stickers WHERE item_id IN (${ids.map(() => "?").join(",")}) ORDER BY item_id, slot`)
    .all(...ids) as StickerRow[];
  for (const r of rows) {
    const list = out.get(r.item_id);
    const sticker = { slot: r.slot, name: r.name, marketHashName: r.market_hash_name, wear: r.wear };
    if (list) list.push(sticker);
    else out.set(r.item_id, [sticker]);
  }
  return out;
}

/** Every storage unit in use, with how many items are kept there. */
export function listStorageUnits(): Array<{ storageUnit: string; items: number }> {
  return getDb()
    .prepare(
      `SELECT storage_unit AS storageUnit, COUNT(*) AS items FROM items
       WHERE storage_unit IS NOT NULL AND trim(storage_unit) != '' AND quantity > 0
       GROUP BY storage_unit ORDER BY storage_unit COLLATE NOCASE`,
    )
    .all() as Array<{ storageUnit: string; items: number }>;
}

/** Whether this item still cannot be traded, at the moment asked. */
export function isTradeLocked(item: ItemRecord, now = new Date()): boolean {
  if (!item.tradableAfter) return false;
  const at = new Date(item.tradableAfter);
  return !Number.isNaN(at.getTime()) && at > now;
}

export function addSnapshot(itemId: number, summary: PriceSummary): PriceSnapshot {
  const result = getDb()
    .prepare("INSERT INTO price_snapshots (item_id, fetched_at, summary) VALUES (?, ?, ?)")
    .run(itemId, summary.fetchedAt, JSON.stringify(summary));
  touch(getItem(itemId));
  return { id: Number(result.lastInsertRowid), itemId, fetchedAt: summary.fetchedAt, summary };
}

interface SnapshotRow {
  id: number;
  item_id: number;
  fetched_at: string;
  summary: string;
}

function rowToSnapshot(r: SnapshotRow): PriceSnapshot {
  return { id: r.id, itemId: r.item_id, fetchedAt: r.fetched_at, summary: JSON.parse(r.summary) as PriceSummary };
}

export function listSnapshots(itemId: number, limit = 50): PriceSnapshot[] {
  return (
    getDb()
      .prepare("SELECT * FROM price_snapshots WHERE item_id = ? ORDER BY fetched_at DESC, id DESC LIMIT ?")
      .all(itemId, limit) as SnapshotRow[]
  ).map(rowToSnapshot);
}

export function latestSnapshot(itemId: number): PriceSnapshot | null {
  return listSnapshots(itemId, 1)[0] ?? null;
}

/** Every snapshot, oldest first (for the portfolio history). */
export function allSnapshots(): PriceSnapshot[] {
  return (
    getDb().prepare("SELECT * FROM price_snapshots ORDER BY fetched_at ASC, id ASC").all() as SnapshotRow[]
  ).map(rowToSnapshot);
}

/** Latest snapshot for every item in one query (for the inventory view). */
export function latestSnapshotsByItem(): Map<number, PriceSnapshot> {
  const rows = getDb()
    .prepare(
      `SELECT s.* FROM price_snapshots s
       JOIN (SELECT item_id, MAX(id) AS max_id FROM price_snapshots GROUP BY item_id) m
         ON m.max_id = s.id`,
    )
    .all() as SnapshotRow[];
  const map = new Map<number, PriceSnapshot>();
  for (const r of rows) map.set(r.item_id, rowToSnapshot(r));
  return map;
}

export { costBasisByItem };
