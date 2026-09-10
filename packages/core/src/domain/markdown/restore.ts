import type { Ledger } from "../acquisitions";
import type { DomainDb } from "../db";
import type { Mirror } from "./mirror";
import type { Repository } from "../repository";
import type { DomainSpec, ItemRecord, PriceSummary } from "../spec";
import { isSafeEntryName, readZip } from "../../zip";
import { parseItemMarkdown } from "./document";

/**
 * Reading a collection back out of its Markdown files.
 *
 * The rule is "the folder wins for the items it names". A file whose `id`
 * matches an item already here replaces that item; a file with an unused id
 * keeps it; anything else is added as a new item. Importing the same folder
 * twice therefore changes nothing the second time.
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

export const IMPORT_MAX_BYTES = 128 * 1024 * 1024;

export function createRestore<F extends object, S extends object, X extends object>(ctx: {
  spec: DomainSpec<F, S, X, unknown>;
  db: DomainDb;
  repo: Repository<F, X>;
  ledger: Ledger;
  mirror: Mirror<F>;
  settings: () => Settingsish;
}) {
  const { spec, db, repo, ledger, mirror } = ctx;

  function importItemFiles(files: Array<{ name: string; text: string }>): CollectionImport {
    const result: CollectionImport = { created: 0, replaced: 0, sales: 0, acquisitions: 0, prices: 0, skipped: [], warnings: [] };
    const conn = db.getDb();
    const touched = new Map<number, boolean>();

    const run = conn.transaction(() => {
      for (const file of files) {
        const parsed = parseItemMarkdown(spec, file.text);
        if (!parsed) {
          result.skipped.push({ file: file.name, reason: `No ${spec.noun.singular} record in this file` });
          continue;
        }
        for (const message of parsed.warnings) result.warnings.push({ file: file.name, message });

        let clean;
        try {
          clean = repo.normalize(parsed.input);
        } catch (e) {
          result.skipped.push({ file: file.name, reason: e instanceof Error ? e.message : String(e) });
          continue;
        }

        let item: ItemRecord<F> | null = null;
        const wanted = parsed.id;
        const holder = wanted === null ? null : repo.getItem(wanted);
        const match = holder && repo.isSameItem(holder, clean) ? holder : elsewhere(clean);
        if (match) {
          if (holder && match !== holder) {
            result.warnings.push({
              file: file.name,
              message: `${capitalize(spec.noun.singular)} ${wanted} here is "${spec.title(holder)}", so this file was matched to the one already in the collection rather than by its id`,
            });
          }
          item = repo.updateItem(match.id, parsed.input);
          if (item) {
            result.replaced++;
            touched.set(item.id, true);
          }
        } else {
          if (holder) {
            result.warnings.push({
              file: file.name,
              message: `${capitalize(spec.noun.singular)} ${wanted} here is a different ${spec.noun.singular} ("${spec.title(holder)}"), so this file was added as new rather than replacing it`,
            });
          }
          item = repo.createItem(parsed.input);
          result.created++;
          if (!holder && wanted !== null && wanted !== item.id) item = adoptId(item, wanted) ?? item;
          touched.set(item.id, false);
        }
        if (!item) {
          result.skipped.push({ file: file.name, reason: "Could not be written to the collection" });
          continue;
        }
        if (!touched.has(item.id)) touched.set(item.id, true);

        if (parsed.createdAt || parsed.updatedAt) {
          conn.prepare("UPDATE items SET created_at = COALESCE(?, created_at), updated_at = COALESCE(?, updated_at) WHERE id = ?").run(parsed.createdAt, parsed.updatedAt, item.id);
        }

        // The file is the record of this item's history, so it replaces what
        // is held rather than adding to it; that is what makes a repeat import safe.
        conn.prepare("DELETE FROM acquisitions WHERE item_id = ?").run(item.id);
        const restoredLots: Array<{ id: number; day: string; unitCost: number | null }> = [];
        for (const lot of parsed.acquisitions) {
          const inserted = conn
            .prepare(
              `INSERT INTO acquisitions (item_id, quantity, remaining, unit_cost, acquired_at, source, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(item.id, lot.quantity, lot.remaining, lot.unitCost, lot.acquiredAt, lot.source, lot.notes, lot.acquiredAt);
          restoredLots.push({ id: Number(inserted.lastInsertRowid), day: lot.acquiredAt.slice(0, 10), unitCost: lot.unitCost });
          result.acquisitions++;
        }

        conn.prepare("DELETE FROM sales WHERE item_id = ?").run(item.id);
        for (const sale of parsed.sales) {
          const inserted = conn
            .prepare(
              `INSERT INTO sales (item_id, quantity, unit_price, fees, unit_cost, sold_at, venue, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(item.id, sale.quantity, sale.unitPrice, sale.fees, sale.unitCost, sale.soldAt, sale.venue, sale.notes, sale.soldAt);
          const saleId = Number(inserted.lastInsertRowid);
          for (const took of sale.lots) {
            const lot = restoredLots.find((l) => l.day === took.acquiredOn && l.unitCost === took.unitCost);
            conn.prepare("INSERT INTO sale_lots (sale_id, acquisition_id, quantity, unit_cost) VALUES (?, ?, ?, ?)").run(saleId, lot?.id ?? null, took.quantity, took.unitCost);
          }
          result.sales++;
        }

        conn.prepare("DELETE FROM price_snapshots WHERE item_id = ?").run(item.id);
        const oldestFirst = [...parsed.snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
        for (const snapshot of oldestFirst) {
          const summary: PriceSummary<X> = {
            ...spec.pricing.summarize({ item, quotes: [], errors: [], settings: ctx.settings() as never, fetchedAt: snapshot.fetchedAt }),
            currency: "USD",
            fetchedAt: snapshot.fetchedAt,
            yourCopyValue: snapshot.yourCopyValue,
            yourCopyBasis: snapshot.yourCopyBasis,
            quotes: [],
            errors: [],
          };
          conn.prepare("INSERT INTO price_snapshots (item_id, fetched_at, summary) VALUES (?, ?, ?)").run(item.id, snapshot.fetchedAt, JSON.stringify(summary));
          result.prices++;
        }

        const held = parsed.acquisitions.reduce((n, lot) => n + lot.remaining, 0);
        if (held !== item.quantity) {
          result.warnings.push({
            file: file.name,
            message: `This file says ${item.quantity} cop${item.quantity === 1 ? "y" : "ies"} but its purchases account for ${held}; the difference was recorded with no cost`,
          });
          ledger.reconcileToQuantity(item.id, item.quantity);
        }
      }
    });

    try {
      run();
    } catch (e) {
      repo.discardDeferredMirror();
      throw e;
    }
    repo.discardDeferredMirror();
    for (const [id, mayHaveOldName] of touched) {
      const item = repo.getItem(id);
      if (item) mirror.mirrorItem(item, { mayHaveOldName });
    }
    return result;
  }

  function elsewhere(clean: ReturnType<Repository<F, X>["normalize"]>): ItemRecord<F> | null {
    const candidates = repo.findSimilar(clean).filter((c) => repo.isSameItem(c, clean));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function adoptId(item: ItemRecord<F>, wanted: number): ItemRecord<F> | null {
    const conn = db.getDb();
    if (!Number.isInteger(wanted) || wanted < 1) return null;
    if (repo.getItem(wanted)) return null;
    conn.pragma("defer_foreign_keys = ON");
    conn.prepare("UPDATE items SET id = ? WHERE id = ?").run(wanted, item.id);
    for (const table of ["acquisitions", "price_snapshots", "sales", "alerts"]) {
      conn.prepare(`UPDATE ${table} SET item_id = ? WHERE item_id = ?`).run(wanted, item.id);
    }
    conn.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT MAX(id) FROM items)) WHERE name = 'items'").run();
    return repo.getItem(wanted);
  }

  function isItemFileName(name: string): boolean {
    const base = name.split("/").pop() ?? "";
    if (!base.toLowerCase().endsWith(".md")) return false;
    return base !== "index.md" && base.toLowerCase() !== "readme.md";
  }

  async function itemFilesFromZip(archive: Uint8Array): Promise<Array<{ name: string; text: string }>> {
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

  function importFromDisk(): CollectionImport {
    return importItemFiles(mirror.readItemFiles());
  }

  return { importItemFiles, importFromDisk, itemFilesFromZip, isItemFileName };
}

type Settingsish = object;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
