import { createCard, discardDeferredMirror, flushDeferredMirror, getCard, updateCard } from "../cards";
import { getDb } from "../db";
import type { CardRecord } from "../types";
import { isSafeEntryName, readZip } from "../zip";
import { parseCardMarkdown } from "./card";
import { readCardFiles } from "./mirror";

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
  prices: number;
  skipped: Array<{ file: string; reason: string }>;
  warnings: Array<{ file: string; message: string }>;
}

/** Ceiling for an uploaded folder; a collection larger than this is restored by hand. */
export const IMPORT_MAX_BYTES = 128 * 1024 * 1024;

export function importCardFiles(files: Array<{ name: string; text: string }>): CollectionImport {
  const result: CollectionImport = { created: 0, replaced: 0, sales: 0, prices: 0, skipped: [], warnings: [] };
  const db = getDb();

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
      const existing = wanted === null ? null : getCard(wanted);
      if (existing) {
        card = updateCard(existing.id, parsed.input);
        if (card) result.replaced++;
      } else {
        card = createCard(parsed.input);
        result.created++;
        if (wanted !== null && wanted !== card.id) {
          card = adoptId(card, wanted) ?? card;
        }
      }
      if (!card) {
        result.skipped.push({ file: file.name, reason: "Could not be written to the collection" });
        continue;
      }

      if (parsed.createdAt || parsed.updatedAt) {
        db.prepare("UPDATE cards SET created_at = COALESCE(?, created_at), updated_at = COALESCE(?, updated_at) WHERE id = ?").run(
          parsed.createdAt,
          parsed.updatedAt,
          card.id,
        );
      }

      // The file is the record of this card's history, so it replaces what is
      // held rather than adding to it; that is what makes a repeat import safe.
      db.prepare("DELETE FROM sales WHERE card_id = ?").run(card.id);
      for (const sale of parsed.sales) {
        db.prepare(
          `INSERT INTO sales (card_id, quantity, unit_price, fees, unit_cost, sold_at, venue, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(card.id, sale.quantity, sale.unitPrice, sale.fees, sale.unitCost, sale.soldAt, sale.venue, sale.notes, sale.soldAt);
        result.sales++;
      }

      db.prepare("DELETE FROM price_snapshots WHERE card_id = ?").run(card.id);
      for (const snapshot of parsed.snapshots) {
        db.prepare("INSERT INTO price_snapshots (card_id, fetched_at, summary) VALUES (?, ?, ?)").run(
          card.id,
          snapshot.fetchedAt,
          JSON.stringify(snapshot.summary),
        );
        result.prices++;
      }
    }
  });

  try {
    run();
  } catch (e) {
    discardDeferredMirror();
    throw e;
  }
  // The files just read are rewritten from what was stored, which normalises
  // a hand-edited folder and gives every card the file name it should have.
  flushDeferredMirror();
  return result;
}

/**
 * Move a freshly created card onto the id its file claims, so that a collection
 * rebuilt from files keeps the numbering its links and file names use. Only the
 * card row exists at this point, so nothing references the id being changed.
 */
function adoptId(card: CardRecord, wanted: number): CardRecord | null {
  const db = getDb();
  if (!Number.isInteger(wanted) || wanted < 1) return null;
  if (getCard(wanted)) return null;
  db.prepare("UPDATE cards SET id = ? WHERE id = ?").run(wanted, card.id);
  // AUTOINCREMENT hands out one past the high-water mark, which the update above
  // does not raise; leaving it behind would hand out an id that already exists.
  db.prepare("UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM cards) WHERE name = 'cards'").run();
  return getCard(wanted);
}

/** Pull the card files out of an uploaded zip of the collection folder. */
export async function cardFilesFromZip(archive: Uint8Array): Promise<Array<{ name: string; text: string }>> {
  const entries = await readZip(archive, { maxTotalBytes: IMPORT_MAX_BYTES, maxEntries: 100_000 });
  const files: Array<{ name: string; text: string }> = [];
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) throw new Error(`The archive contains an unsafe path: ${entry.name}`);
    const base = entry.name.split("/").pop() ?? "";
    if (!base.toLowerCase().endsWith(".md")) continue;
    if (base === "index.md" || base === "README.md") continue;
    files.push({ name: entry.name, text: new TextDecoder().decode(entry.data) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return files;
}

/** Read the collection back out of the folder this app maintains. */
export function importFromDisk(): CollectionImport {
  return importCardFiles(readCardFiles());
}
