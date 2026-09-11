import { reconcileToQuantity } from "../acquisitions";
import { createCard, discardDeferredMirror, findSimilar, getCard, updateCard } from "../cards";
import { getDb } from "../db";
import type { CardInput, CardRecord } from "../types";
import { isSafeEntryName, readZip } from "@collectcollect/core/zip";
import { parseCardMarkdown } from "./card";
import { mirrorCard, readCardFiles } from "./mirror";

/**
 * Reading a collection back out of its Markdown files.
 *
 * The rule is "the folder wins for the cards it names". A file whose `id`
 * matches a card already here replaces that card; a file with an unused id
 * keeps it; anything else is added as a new card. Importing the same folder
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

/** Ceiling for an uploaded folder; a collection larger than this is restored by hand. */
export const IMPORT_MAX_BYTES = 128 * 1024 * 1024;

export function importCardFiles(files: Array<{ name: string; text: string }>): CollectionImport {
  const result: CollectionImport = { created: 0, replaced: 0, sales: 0, acquisitions: 0, prices: 0, skipped: [], warnings: [] };
  const db = getDb();
  /** Card id -> whether it could already be filed under another name. */
  const touched = new Map<number, boolean>();

  const run = db.transaction(() => {
    for (const file of files) {
      const parsed = parseCardMarkdown(file.text);
      if (!parsed) {
        result.skipped.push({ file: file.name, reason: "No card record in this file" });
        continue;
      }
      for (const message of parsed.warnings) result.warnings.push({ file: file.name, message });

      let card: CardRecord | null = null;
      const wanted = parsed.id;
      const holder = wanted === null ? null : getCard(wanted);
      const match = holder && isSameCard(holder, parsed.input) ? holder : elsewhere(parsed);
      if (match) {
        if (holder && match !== holder) {
          result.warnings.push({
            file: file.name,
            message: `Card ${wanted} here is "${holder.name}", so this file was matched to the copy already in the collection rather than by its id`,
          });
        }
        card = updateCard(match.id, parsed.input);
        if (card) result.replaced++;
        if (card) touched.set(card.id, true);
      } else {
        if (holder) {
          result.warnings.push({
            file: file.name,
            message: `Card ${wanted} here is a different card ("${holder.name}"${holder.grade ? `, ${holder.gradingCompany ?? "graded"} ${holder.grade}` : ""}), so this file was added as a new card rather than replacing it`,
          });
        }
        card = createCard(parsed.input);
        result.created++;
        if (!holder && wanted !== null && wanted !== card.id) {
          card = adoptId(card, wanted) ?? card;
        }
        // Brand new, so nothing of its own can be left behind under another name.
        touched.set(card.id, false);
      }
      if (!card) {
        result.skipped.push({ file: file.name, reason: "Could not be written to the collection" });
        continue;
      }
      if (!touched.has(card.id)) touched.set(card.id, true);

      if (parsed.createdAt || parsed.updatedAt) {
        db.prepare("UPDATE cards SET created_at = COALESCE(?, created_at), updated_at = COALESCE(?, updated_at) WHERE id = ?").run(
          parsed.createdAt,
          parsed.updatedAt,
          card.id,
        );
      }

      // The file is the record of this card's history, so it replaces what is
      // held rather than adding to it; that is what makes a repeat import safe.

      // Purchases first: the sales below say which of them they took from.
      // The file records how many copies each lot has left, so they go in
      // exactly as written rather than being replayed against the sales.
      db.prepare("DELETE FROM acquisitions WHERE card_id = ?").run(card.id);
      const restoredLots: Array<{ id: number; day: string; unitCost: number | null }> = [];
      for (const lot of parsed.acquisitions) {
        const inserted = db
          .prepare(
            `INSERT INTO acquisitions (card_id, quantity, remaining, unit_cost, acquired_at, source, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(card.id, lot.quantity, lot.remaining, lot.unitCost, lot.acquiredAt, lot.source, lot.notes, lot.acquiredAt);
        restoredLots.push({ id: Number(inserted.lastInsertRowid), day: lot.acquiredAt.slice(0, 10), unitCost: lot.unitCost });
        result.acquisitions++;
      }

      db.prepare("DELETE FROM sales WHERE card_id = ?").run(card.id);
      for (const sale of parsed.sales) {
        const inserted = db
          .prepare(
            `INSERT INTO sales (card_id, quantity, unit_price, fees, unit_cost, sold_at, venue, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(card.id, sale.quantity, sale.unitPrice, sale.fees, sale.unitCost, sale.soldAt, sale.venue, sale.notes, sale.soldAt);
        const saleId = Number(inserted.lastInsertRowid);
        // Which copies this sale took, matched back to the lots just restored
        // by the day they were bought and what they cost. A file that predates
        // the column simply has no provenance, and undoing such a sale
        // reconstructs a lot instead of restoring one.
        for (const took of sale.lots) {
          const match = restoredLots.find((lot) => lot.day === took.acquiredOn && lot.unitCost === took.unitCost);
          db.prepare("INSERT INTO sale_lots (sale_id, acquisition_id, quantity, unit_cost) VALUES (?, ?, ?, ?)").run(
            saleId,
            match?.id ?? null,
            took.quantity,
            took.unitCost,
          );
        }
        result.sales++;
      }

      db.prepare("DELETE FROM price_snapshots WHERE card_id = ?").run(card.id);
      // The file lists prices newest first, for reading. They go back in the
      // other way round: the newest snapshot has to end up with the highest
      // id, which is how the app finds a card's current value.
      const oldestFirst = [...parsed.snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
      for (const snapshot of oldestFirst) {
        db.prepare("INSERT INTO price_snapshots (card_id, fetched_at, summary) VALUES (?, ?, ?)").run(
          card.id,
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
      if (held !== card.quantity) {
        result.warnings.push({
          file: file.name,
          message: `This file says ${card.quantity} cop${card.quantity === 1 ? "y" : "ies"} but its purchases account for ${held}; the difference was recorded with no cost`,
        });
        reconcileToQuantity(card.id, card.quantity);
      }
    }
  });

  try {
    run();
  } catch (e) {
    discardDeferredMirror();
    throw e;
  }
  // Mirror by the ids the cards actually ended up with rather than the ones
  // the repository queued, since a card can be moved onto the id its file
  // claims. Rewriting also normalises a hand-edited folder, giving every card
  // the file name and layout it should have.
  discardDeferredMirror();
  for (const [id, mayHaveOldName] of touched) {
    const card = getCard(id);
    if (card) mirrorCard(card, { mayHaveOldName });
  }
  return result;
}

/**
 * The card this file describes, when its id is taken by something else. Without
 * this an import into a collection whose ids are already in use would add a
 * fresh copy every time it was run, which is the opposite of what someone
 * recovering data needs.
 */
function elsewhere(parsed: { input: CardInput }): CardRecord | null {
  const candidates = findSimilar({
    game: parsed.input.game,
    name: parsed.input.name,
    cardNumber: parsed.input.cardNumber ?? null,
    setName: parsed.input.setName ?? null,
  }).filter((c) => isSameCard(c, parsed.input));
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Is this card the one the file describes? Names have to agree, sets have to
 * agree when both sides name one, and the copies have to be interchangeable:
 * a raw card and a slab of the same card are different objects, worth
 * different money, with different histories. Scanning already refuses to fold
 * one into the other; a recovery tool, where being wrong costs the history
 * rather than a quantity, has no business being more permissive.
 */
function isSameCard(existing: CardRecord, input: CardInput): boolean {
  if (norm(existing.name) !== norm(input.name)) return false;
  const a = norm(existing.setName);
  const b = norm(input.setName ?? null);
  if (a && b && a !== b) return false;
  return norm(existing.grade) === norm(input.grade ?? null) && norm(existing.gradingCompany) === norm(input.gradingCompany ?? null);
}

/**
 * Move a freshly created card onto the id its file claims, so that a collection
 * rebuilt from files keeps the numbering its links and file names use.
 */
function adoptId(card: CardRecord, wanted: number): CardRecord | null {
  const db = getDb();
  if (!Number.isInteger(wanted) || wanted < 1) return null;
  if (getCard(wanted)) return null;
  // The card now has children — its acquisition lot, and in principle anything
  // else keyed on the card — so parent and children have to move together.
  // Deferring foreign keys holds the check until the transaction commits, by
  // which point both ends agree; the pragma is scoped to this transaction.
  db.pragma("defer_foreign_keys = ON");
  db.prepare("UPDATE cards SET id = ? WHERE id = ?").run(wanted, card.id);
  for (const table of ["acquisitions", "price_snapshots", "sales", "submission_cards", "alerts"]) {
    db.prepare(`UPDATE ${table} SET card_id = ? WHERE card_id = ?`).run(wanted, card.id);
  }
  // AUTOINCREMENT hands out one past the high-water mark, which the update above
  // does not raise; leaving it behind would hand out an id that already exists.
  // Never lower the mark: ids that belonged to deleted cards must not be
  // handed out again.
  db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT MAX(id) FROM cards)) WHERE name = 'cards'").run();
  return getCard(wanted);
}

/** The folder's own index and explainer are not cards. */
export function isCardFileName(name: string): boolean {
  const base = name.split("/").pop() ?? "";
  if (!base.toLowerCase().endsWith(".md")) return false;
  return base !== "index.md" && base.toLowerCase() !== "readme.md";
}

/** Pull the card files out of an uploaded zip of the collection folder. */
export async function cardFilesFromZip(archive: Uint8Array): Promise<Array<{ name: string; text: string }>> {
  const entries = await readZip(archive, { maxTotalBytes: IMPORT_MAX_BYTES, maxEntries: 100_000 });
  const files: Array<{ name: string; text: string }> = [];
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) throw new Error(`The archive contains an unsafe path: ${entry.name}`);
    const base = entry.name.split("/").pop() ?? "";
    if (!isCardFileName(base)) continue;
    files.push({ name: entry.name, text: new TextDecoder().decode(entry.data) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return files;
}

/** Read the collection back out of the folder this app maintains. */
export function importFromDisk(): CollectionImport {
  return importCardFiles(readCardFiles());
}
