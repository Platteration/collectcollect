import { reconcileToQuantity } from "../acquisitions";
import { getDb } from "../db";
import {
  createItem,
  discardDeferredMirror,
  findByAssetId,
  getItem,
  listByMarketHashName,
  updateItem,
} from "../items";
import type { ItemInput, ItemRecord } from "../types";
import { isStackable } from "../types";
import { isSafeEntryName, readZip } from "@collectcollect/core/zip";
import { parseItemMarkdown } from "./item";
import { mirrorItem, readItemFiles } from "./mirror";

/**
 * Reading an inventory back out of its Markdown files.
 *
 * The rule is "the folder wins for the items it names". A file whose `id`
 * matches an item already here replaces that item; a file with an unused id
 * keeps it; anything else is added as a new item. Importing the same folder
 * twice therefore changes nothing the second time, which is what you want when
 * you are recovering data and unsure what you already have.
 */

export interface CollectionImport {
  created: number;
  replaced: number;
  sales: number;
  acquisitions: number;
  prices: number;
  skipped: Array<{ file: string; reason: string }>;
  warnings: Array<{ file: string; message: string }>;
}

/** Ceiling for an uploaded folder; an inventory larger than this is restored by hand. */
export const IMPORT_MAX_BYTES = 128 * 1024 * 1024;

export function importItemFiles(files: Array<{ name: string; text: string }>): CollectionImport {
  const result: CollectionImport = { created: 0, replaced: 0, sales: 0, acquisitions: 0, prices: 0, skipped: [], warnings: [] };
  const db = getDb();
  /** Item id -> whether it could already be filed under another name. */
  const touched = new Map<number, boolean>();

  const run = db.transaction(() => {
    for (const file of files) {
      const parsed = parseItemMarkdown(file.text);
      if (!parsed) {
        result.skipped.push({ file: file.name, reason: "No item record in this file" });
        continue;
      }
      for (const message of parsed.warnings) result.warnings.push({ file: file.name, message });

      let item: ItemRecord | null = null;
      const wanted = parsed.id;
      const holder = wanted === null ? null : getItem(wanted);
      const match = holder && isSameItem(holder, parsed.input) ? holder : elsewhere(parsed.input);
      if (match) {
        if (holder && match !== holder) {
          result.warnings.push({
            file: file.name,
            message: `Item ${wanted} here is "${holder.marketHashName}", so this file was matched to the one already in the inventory rather than by its id`,
          });
        }
        item = updateItem(match.id, parsed.input);
        if (item) result.replaced++;
        if (item) touched.set(item.id, true);
      } else {
        if (holder) {
          result.warnings.push({
            file: file.name,
            message: `Item ${wanted} here is a different item ("${holder.marketHashName}"), so this file was added as a new item rather than replacing it`,
          });
        }
        item = createItem(parsed.input);
        result.created++;
        if (!holder && wanted !== null && wanted !== item.id) {
          item = adoptId(item, wanted) ?? item;
        }
        // Brand new, so nothing of its own can be left behind under another name.
        touched.set(item.id, false);
      }
      if (!item) {
        result.skipped.push({ file: file.name, reason: "Could not be written to the inventory" });
        continue;
      }
      if (!touched.has(item.id)) touched.set(item.id, true);

      if (parsed.createdAt || parsed.updatedAt) {
        db.prepare("UPDATE items SET created_at = COALESCE(?, created_at), updated_at = COALESCE(?, updated_at) WHERE id = ?").run(
          parsed.createdAt,
          parsed.updatedAt,
          item.id,
        );
      }

      // The file is the record of this item's history, so it replaces what is
      // held rather than adding to it; that is what makes a repeat import safe.

      // Purchases first: the sales below say which of them they took from. The
      // file records how many copies each lot has left, so they go in exactly
      // as written rather than being replayed against the sales.
      db.prepare("DELETE FROM acquisitions WHERE item_id = ?").run(item.id);
      const restoredLots: Array<{ id: number; day: string; unitCost: number | null }> = [];
      for (const lot of parsed.acquisitions) {
        const inserted = db
          .prepare(
            `INSERT INTO acquisitions (item_id, quantity, remaining, unit_cost, acquired_at, source, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(item.id, lot.quantity, lot.remaining, lot.unitCost, lot.acquiredAt, lot.source, lot.notes, lot.acquiredAt);
        restoredLots.push({ id: Number(inserted.lastInsertRowid), day: lot.acquiredAt.slice(0, 10), unitCost: lot.unitCost });
        result.acquisitions++;
      }

      db.prepare("DELETE FROM sales WHERE item_id = ?").run(item.id);
      for (const sale of parsed.sales) {
        const inserted = db
          .prepare(
            `INSERT INTO sales (item_id, quantity, unit_price, fees, unit_cost, sold_at, venue, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(item.id, sale.quantity, sale.unitPrice, sale.fees, sale.unitCost, sale.soldAt, sale.venue, sale.notes, sale.soldAt);
        const saleId = Number(inserted.lastInsertRowid);
        // Which copies this sale took, matched back to the lots just restored by
        // the day they were bought and what they cost. A file with no
        // provenance column simply has none, and undoing such a sale
        // reconstructs a lot instead of restoring one.
        for (const took of sale.lots) {
          const lot = restoredLots.find((l) => l.day === took.acquiredOn && l.unitCost === took.unitCost);
          db.prepare("INSERT INTO sale_lots (sale_id, acquisition_id, quantity, unit_cost) VALUES (?, ?, ?, ?)").run(
            saleId,
            lot?.id ?? null,
            took.quantity,
            took.unitCost,
          );
        }
        result.sales++;
      }

      db.prepare("DELETE FROM price_snapshots WHERE item_id = ?").run(item.id);
      // The file lists prices newest first, for reading. They go back in the
      // other way round: the newest snapshot has to end up with the highest id,
      // which is how the app finds an item's current value.
      const oldestFirst = [...parsed.snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
      for (const snapshot of oldestFirst) {
        db.prepare("INSERT INTO price_snapshots (item_id, fetched_at, summary) VALUES (?, ?, ?)").run(
          item.id,
          snapshot.fetchedAt,
          JSON.stringify(snapshot.summary),
        );
        result.prices++;
      }

      // The quantity in the front matter is what a person reads at the top of
      // the file and in the index, so it decides how many copies there are; the
      // purchases decide what they cost. In a hand-edited file where the two
      // disagree, the gap is closed with copies of unknown cost rather than by
      // inventing a price, and the difference is reported.
      const held = parsed.acquisitions.reduce((n, lot) => n + lot.remaining, 0);
      if (held !== item.quantity) {
        result.warnings.push({
          file: file.name,
          message: `This file says ${item.quantity} cop${item.quantity === 1 ? "y" : "ies"} but its purchases account for ${held}; the difference was recorded with no cost`,
        });
        reconcileToQuantity(item.id, item.quantity);
      }
    }
  });

  try {
    run();
  } catch (e) {
    discardDeferredMirror();
    throw e;
  }
  // Mirror by the ids the items actually ended up with rather than the ones the
  // repository queued, since an item can be moved onto the id its file claims.
  // Rewriting also normalises a hand-edited folder, giving every item the file
  // name and layout it should have.
  discardDeferredMirror();
  for (const [id, mayHaveOldName] of touched) {
    const item = getItem(id);
    if (item) mirrorItem(item, { mayHaveOldName });
  }
  return result;
}

/**
 * The item this file describes, when its id is taken by something else. Without
 * this, an import into an inventory whose ids are already in use would add a
 * fresh copy every time it was run, which is the opposite of what someone
 * recovering data needs.
 */
function elsewhere(input: ItemInput): ItemRecord | null {
  // An asset id names one object in one Steam account. Nothing else needs
  // checking, and nothing else is as reliable.
  if (input.assetId) {
    const byAsset = findByAssetId(input.assetId);
    if (byAsset) return byAsset;
  }
  const candidates = listByMarketHashName(input.marketHashName).filter((i) => isSameItem(i, input));
  return candidates.length === 1 ? candidates[0] : null;
}

function eq(a: number | null | undefined, b: number | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * Is this row the object the file describes?
 *
 * For a case or a sticker, the market hash name is the whole identity: one
 * Clutch Case is any other. For a weapon, a knife or a pair of gloves it is
 * not — the float and the pattern seed are what make that object that object,
 * and two Field-Tested Redlines with different floats are different things
 * worth different money. Treating them as one would merge two histories into
 * one and lose a purchase.
 */
function isSameItem(existing: ItemRecord, input: ItemInput): boolean {
  if (existing.marketHashName !== input.marketHashName) return false;
  const assetId = input.assetId ?? null;
  // Two different objects can never share an asset id, so a disagreement here
  // is decisive whichever way round it falls.
  if (assetId !== null && existing.assetId !== null && existing.assetId !== assetId) return false;
  if (isStackable(existing.category)) return true;
  return eq(existing.floatValue, input.floatValue) && eq(existing.paintSeed, input.paintSeed);
}

/**
 * Move a freshly created item onto the id its file claims, so that an inventory
 * rebuilt from files keeps the numbering its links and file names use.
 */
function adoptId(item: ItemRecord, wanted: number): ItemRecord | null {
  const db = getDb();
  if (!Number.isInteger(wanted) || wanted < 1) return null;
  if (getItem(wanted)) return null;
  // The item now has children — its acquisition lot, its stickers, and in
  // principle anything else keyed on the item — so parent and children have to
  // move together. Deferring foreign keys holds the check until the transaction
  // commits, by which point both ends agree; the pragma is scoped to this
  // transaction.
  db.pragma("defer_foreign_keys = ON");
  db.prepare("UPDATE items SET id = ? WHERE id = ?").run(wanted, item.id);
  for (const table of ["item_stickers", "acquisitions", "price_snapshots", "sales", "alerts"]) {
    db.prepare(`UPDATE ${table} SET item_id = ? WHERE item_id = ?`).run(wanted, item.id);
  }
  // AUTOINCREMENT hands out one past the high-water mark, which the update above
  // does not raise; leaving it behind would hand out an id that already exists.
  // Never lower the mark: ids that belonged to deleted items must not be handed
  // out again.
  db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT MAX(id) FROM items)) WHERE name = 'items'").run();
  return getItem(wanted);
}

/** The folder's own index and explainer are not items. */
export function isItemFileName(name: string): boolean {
  const base = name.split("/").pop() ?? "";
  if (!base.toLowerCase().endsWith(".md")) return false;
  return base !== "index.md" && base.toLowerCase() !== "readme.md";
}

/** Pull the item files out of an uploaded zip of the inventory folder. */
export async function itemFilesFromZip(archive: Uint8Array): Promise<Array<{ name: string; text: string }>> {
  const entries = await readZip(archive, { maxTotalBytes: IMPORT_MAX_BYTES, maxEntries: 100_000 });
  const files: Array<{ name: string; text: string }> = [];
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) throw new Error(`The archive contains an unsafe path: ${entry.name}`);
    const base = entry.name.split("/").pop() ?? "";
    if (!isItemFileName(base)) continue;
    files.push({ name: entry.name, text: new TextDecoder().decode(entry.data) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return files;
}

/** Read the inventory back out of the folder this app maintains. */
export function importFromDisk(): CollectionImport {
  return importItemFiles(readItemFiles());
}
