import fs from "node:fs";
import path from "node:path";
import { listLots, listSaleLots } from "../acquisitions";
import { dataDir, getDb } from "../db";
import type { Category, Exterior, ItemRecord, PriceSnapshot, Sale } from "../types";
import { CATEGORIES, EXTERIORS } from "../types";
import { INDEX_HEADERS, idFromFileName, itemFileName, itemMarkdown } from "./item";
import { money, parseDocument, readMoney, readTable, table } from "@collectcollect/core/markdown/format";

/**
 * A live plain-text copy of the inventory.
 *
 * Every item is also a Markdown file on disk, rewritten whenever that item
 * changes. The database stays the thing the app reads, but it is no longer the
 * only place the inventory exists: if this app is never updated again, the
 * folder is still a complete, readable catalogue that any text editor, git
 * repository or note-taking tool can open, and that this app can read back.
 *
 * That matters more here than it does for cards. A card is a physical object
 * you still own whatever happens to any database; a skin is an entry in
 * somebody else's, and the record of what you paid for it is the only part you
 * can actually keep.
 *
 * Mirroring must never be the reason an item fails to save, so every write is
 * wrapped: a full disk or a read-only volume degrades the mirror, not the app.
 */

export function collectionDir(): string {
  return path.join(dataDir(), "collection");
}

export function itemsDir(): string {
  return path.join(collectionDir(), "items");
}

/** Set MARKDOWN_MIRROR=off for a read-only data volume. */
export function mirrorEnabled(): boolean {
  return (process.env.MARKDOWN_MIRROR ?? "on").toLowerCase() !== "off";
}

interface MirrorState {
  lastError: string | null;
  failures: number;
  indexTimer: NodeJS.Timeout | null;
  indexDirty: boolean;
  /** When the index first went out of date, so a long run of changes still writes it. */
  dirtySince: number;
}

const globalForMirror = globalThis as unknown as { __skinsMirror?: MirrorState };
const state: MirrorState = (globalForMirror.__skinsMirror ??= {
  lastError: null,
  failures: 0,
  indexTimer: null,
  indexDirty: false,
  dirtySince: 0,
});

/** Wait this long after the last change before rebuilding the index... */
const INDEX_QUIET_MS = 750;
/** ...but never leave it out of date for longer than this while changes keep coming. */
const INDEX_MAX_WAIT_MS = 15_000;

function note(e: unknown): void {
  state.failures += 1;
  state.lastError = e instanceof Error ? e.message : String(e);
}

/** Write via a temporary file so a crash mid-write cannot leave half an item. */
function writeAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

function ensureDirs(): void {
  fs.mkdirSync(itemsDir(), { recursive: true });
  // The index is rebuilt on a delay, but whoever opens this folder should
  // always find the note explaining what it is, from the very first item.
  const readme = path.join(collectionDir(), "README.md");
  if (!fs.existsSync(readme)) writeAtomic(readme, README);
}

// ---------------------------------------------------------------------------
// Per-item files
// ---------------------------------------------------------------------------

/**
 * The mirror reads what it needs straight from the database rather than from
 * the repository that calls it. Keeping it a leaf module is what stops a
 * mirroring problem from ever being able to break an item write.
 */
function readRows(sql: string, ...params: unknown[]): unknown[] {
  return getDb().prepare(sql).all(...(params as never[]));
}

function salesFor(itemId: number): Sale[] {
  const rows = readRows("SELECT * FROM sales WHERE item_id = ? ORDER BY sold_at DESC, id DESC", itemId) as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    id: Number(r.id),
    itemId: Number(r.item_id),
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    fees: Number(r.fees),
    unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
    soldAt: String(r.sold_at),
    venue: r.venue === null ? null : String(r.venue),
    notes: r.notes === null ? null : String(r.notes),
    createdAt: String(r.created_at),
  }));
}

/**
 * Which lots each of an item's sales took. Written into the file so that
 * undoing a sale after a rebuild returns the copies to the lots they actually
 * came from, rather than to a reconstruction of them.
 */
function saleLotsFor(
  itemId: number,
  sales: Sale[],
): Map<number, Array<{ quantity: number; unitCost: number | null; acquiredAt: string | null }>> {
  const lots = new Map(listLots(itemId).map((lot) => [lot.id, lot]));
  const out = new Map<number, Array<{ quantity: number; unitCost: number | null; acquiredAt: string | null }>>();
  for (const sale of sales) {
    const consumed = listSaleLots(sale.id).map((c) => ({
      quantity: c.quantity,
      unitCost: c.unitCost,
      acquiredAt: c.acquisitionId === null ? null : (lots.get(c.acquisitionId)?.acquiredAt ?? null),
    }));
    if (consumed.length) out.set(sale.id, consumed);
  }
  return out;
}

function snapshotsFor(itemId: number): PriceSnapshot[] {
  const rows = readRows(
    "SELECT * FROM price_snapshots WHERE item_id = ? ORDER BY fetched_at DESC, id DESC",
    itemId,
  ) as Array<Record<string, unknown>>;
  const out: PriceSnapshot[] = [];
  for (const r of rows) {
    try {
      out.push({
        id: Number(r.id),
        itemId: Number(r.item_id),
        fetchedAt: String(r.fetched_at),
        summary: JSON.parse(String(r.summary)),
      });
    } catch {
      /* a snapshot that will not parse is not worth failing the mirror over */
    }
  }
  return out;
}

/** Everything an item's file says, gathered in one place. */
function bundleFor(item: ItemRecord) {
  const sales = salesFor(item.id);
  return { item, sales, snapshots: snapshotsFor(item.id), acquisitions: listLots(item.id), saleLots: saleLotsFor(item.id, sales) };
}

/**
 * Rewrite one item's file. Safe to call for any item, at any time.
 *
 * `mayHaveOldName` says whether this item could already be filed under a
 * different name, which is the only reason to scan the folder for leftovers.
 * An item being created has no history to leave behind, and looking for one
 * would turn importing a whole inventory into a pass over the folder per item.
 */
export function mirrorItem(item: ItemRecord, opts: { mayHaveOldName?: boolean } = {}): void {
  if (!mirrorEnabled()) return;
  try {
    ensureDirs();
    const contents = itemMarkdown(bundleFor(item));
    const wanted = itemFileName(item);
    const file = path.join(itemsDir(), wanted);
    // If the item already has this file, its name cannot have changed.
    const moved = opts.mayHaveOldName !== false && !fs.existsSync(file);
    writeAtomic(file, contents);
    if (moved) dropStaleFiles(item.id, wanted);
    scheduleIndex();
  } catch (e) {
    note(e);
  }
}

/** A renamed item leaves a file behind under its old slug; take it with us. */
function dropStaleFiles(id: number, keep: string): void {
  for (const name of fs.readdirSync(itemsDir())) {
    if (name !== keep && name.endsWith(".md") && idFromFileName(name) === id) {
      fs.rmSync(path.join(itemsDir(), name), { force: true });
    }
  }
}

export function unmirrorItem(id: number): void {
  if (!mirrorEnabled()) return;
  try {
    if (!fs.existsSync(itemsDir())) return;
    for (const name of fs.readdirSync(itemsDir())) {
      if (name.endsWith(".md") && idFromFileName(name) === id) {
        fs.rmSync(path.join(itemsDir(), name), { force: true });
      }
    }
    scheduleIndex();
  } catch (e) {
    note(e);
  }
}

// ---------------------------------------------------------------------------
// The index and the explainer
// ---------------------------------------------------------------------------

/**
 * The index is built from the item files themselves rather than the database,
 * so what it lists is exactly what is on disk. It is rebuilt shortly after a
 * change instead of on every one, which keeps a whole-inventory price refresh
 * from rewriting it once per item.
 */
function scheduleIndex(): void {
  const now = Date.now();
  if (!state.indexDirty) state.dirtySince = now;
  state.indexDirty = true;
  if (state.indexTimer) {
    if (now - state.dirtySince >= INDEX_MAX_WAIT_MS) return;
    clearTimeout(state.indexTimer);
  }
  state.indexTimer = setTimeout(() => {
    state.indexTimer = null;
    if (state.indexDirty) writeIndex();
  }, INDEX_QUIET_MS);
  state.indexTimer.unref?.();
}

/**
 * Write the index now. Used by tests, by rebuilds, and before a backup or a
 * download.
 *
 * It writes whether or not this process knows the index to be out of date. The
 * dirty flag lives in memory, so a restart forgets a pending rebuild — and the
 * index is derived entirely from the files already on disk, so rebuilding one
 * that happened to be current costs a folder read and is always right.
 */
export function flushCollection(): void {
  if (state.indexTimer) {
    clearTimeout(state.indexTimer);
    state.indexTimer = null;
  }
  writeIndex();
}

interface IndexEntry {
  file: string;
  data: Record<string, unknown>;
  value: number | null;
}

function readIndexEntries(): IndexEntry[] {
  const dir = itemsDir();
  if (!fs.existsSync(dir)) return [];
  const entries: IndexEntry[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    try {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, body } = parseDocument(text);
      if (!data.market_hash_name) continue;
      entries.push({ file, data, value: latestValue(body) });
    } catch {
      /* skip a file we cannot read rather than lose the whole index */
    }
  }
  return entries;
}

/** The first data row of the value history table holds the newest price. */
function latestValue(body: string): number | null {
  const first = readTable(body, "Value history")[0];
  return first ? readMoney(first[1] ?? "") : null;
}

function writeIndex(): void {
  if (!mirrorEnabled()) return;
  try {
    ensureDirs();
    const entries = readIndexEntries();
    let total = 0;
    let copies = 0;
    const rows = entries.map((e) => {
      const quantity = Number(e.data.quantity ?? 1) || 0;
      const worth = e.value === null ? null : e.value * quantity;
      if (worth !== null) total += worth;
      copies += quantity;
      const category = String(e.data.category ?? "") as Category;
      const exterior = String(e.data.exterior ?? "") as Exterior;
      const float = Number(e.data.float);
      return [
        `[${String(e.data.market_hash_name ?? "")}](items/${e.file})`,
        Object.hasOwn(CATEGORIES, category) ? CATEGORIES[category] : category,
        Object.hasOwn(EXTERIORS, exterior) ? EXTERIORS[exterior] : exterior,
        Number.isFinite(float) ? String(Number(float.toFixed(10))) : "",
        quantity,
        String(e.data.storage_unit ?? ""),
        worth === null ? "" : money(worth),
      ];
    });

    const doc = [
      "# Inventory",
      "",
      `${entries.length} item${entries.length === 1 ? "" : "s"}, ${copies} cop${copies === 1 ? "y" : "ies"}` +
        (total > 0 ? `, last valued at ${money(total)}.` : "."),
      "",
      "Every row links to that item's own file. See [README.md](README.md) for what these files are.",
      "",
      rows.length ? table(INDEX_HEADERS, rows) : "_Nothing here yet._",
      "",
    ].join("\n");
    writeAtomic(path.join(collectionDir(), "index.md"), doc);
    writeReadme();
    state.indexDirty = false;
  } catch (e) {
    note(e);
  }
}

const README = `# Your inventory, in plain text

This folder is a complete copy of a CollectCollect CS2 inventory, written as
Markdown. It exists so your record outlives the app — and outlives the
marketplaces. The items themselves live in somebody else's database; what you
paid for them, and when, is the part you can actually keep, and it is all here
in files any computer can open.

## What is here

- \`index.md\` — every item in one table, with a link to each item's file. It is
  rebuilt shortly after a change rather than instantly, so the item files are
  the ones to trust if the two ever disagree.
- \`items/\` — one file per item, named \`<id>-<market hash name>.md\`.

Images are not copied here: they are Steam CDN URLs, and each item file records
the link rather than the picture.

## How to read an item file

Every item file starts with a block between \`---\` lines: the item's record —
its market hash name, what kind of thing it is, its wear tier and float, its
pattern seed, how many you have, what you paid, where it is kept. It is written
as YAML with JSON values, which means both people and programs can read it.

Underneath is the same item written for a person: what it is, its stickers,
your notes, every price the app ever recorded for it, what each copy cost, and
any sales.

## Float and pattern

\`float\` is the wear value, 0 through 1, and it is the item's real identity: the
wear tier in the name (Factory New, Field-Tested and so on) is just the band
that float falls in. \`paint_seed\` is the pattern index, which is what makes one
Case Hardened worth more than another with the same float.

## Purchases

The \`Acquisitions\` table is one row per purchase: when you got the copies, how
many, how many of those you still have, and what each one cost. A cost of
\`—\` means nobody recorded what those copies cost, which is a different thing
from an item that was free (that reads \`$0.00\`) — a case opened out of another
case has no purchase price, and saying it cost nothing would read as pure
profit.

Sales are matched to them: the \`Lots\` column on a sale says which purchase each
sold copy came out of, so the profit on a sale is measured against what that
particular copy cost rather than an average. Copies are sold oldest first.

The \`purchase_price\` in the block at the top is the average across the copies
you still hold, worked out from these rows.

## Getting it back into an app

CollectCollect can read this folder back: Settings → "Rebuild from these
files". It matches on the \`id\` in each file, so importing the same folder twice
is safe.

Nothing here needs CollectCollect, though. The front matter is ordinary YAML
and the tables are ordinary Markdown, so a spreadsheet, a script, or a
different tool can take it from here.

## What these files do not hold

The per-market quotes behind each price are left out — the recorded prices
themselves are all here.
`;

function writeReadme(): void {
  writeAtomic(path.join(collectionDir(), "README.md"), README);
}

// ---------------------------------------------------------------------------
// Rebuild and status
// ---------------------------------------------------------------------------

export interface RebuildResult {
  written: number;
  /** Files describing items the database does not have. They are left alone. */
  orphans: number;
}

/**
 * Rewrite the whole folder from the database.
 *
 * Files for items the database does not know about are counted and left where
 * they are. Deleting an item already takes its file with it, so an orphan means
 * the two have come apart — and the likeliest way that happens is someone
 * pointing a fresh, empty install at a folder that is the only copy of their
 * records left. Rewriting must never be the thing that destroys it; the file is
 * the record here, and only a person should decide it is not wanted.
 */
export function rebuildCollection(items: ItemRecord[]): RebuildResult {
  if (!mirrorEnabled()) return { written: 0, orphans: 0 };
  ensureDirs();
  const keep = new Set<string>();
  let written = 0;
  for (const item of items) {
    const name = itemFileName(item);
    writeAtomic(path.join(itemsDir(), name), itemMarkdown(bundleFor(item)));
    keep.add(name);
    written++;
  }
  const known = new Set(items.map((i) => i.id));
  let orphans = 0;
  for (const name of fs.readdirSync(itemsDir())) {
    // .tmp files are half-written items left by a crash; they belong to nobody.
    if (name.endsWith(".tmp")) {
      fs.rmSync(path.join(itemsDir(), name), { force: true });
      continue;
    }
    if (!name.endsWith(".md") || keep.has(name)) continue;
    const id = idFromFileName(name);
    // A file left over from a rename of an item that is still here is stale and
    // says so by its id; anything else describes an item this database lost.
    if (id !== null && known.has(id)) fs.rmSync(path.join(itemsDir(), name), { force: true });
    else orphans++;
  }
  state.indexDirty = true;
  flushCollection();
  state.lastError = null;
  state.failures = 0;
  return { written, orphans };
}

export interface CollectionStatus {
  enabled: boolean;
  dir: string;
  files: number;
  bytes: number;
  updatedAt: string | null;
  failures: number;
  lastError: string | null;
  /** Items in the database, so the page can say when the folder has fallen behind. */
  items: number;
}

export function collectionStatus(): CollectionStatus {
  const dir = itemsDir();
  let files = 0;
  let bytes = 0;
  let newest = 0;
  try {
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (!name.endsWith(".md")) continue;
      const stat = fs.statSync(path.join(dir, name));
      files++;
      bytes += stat.size;
      newest = Math.max(newest, stat.mtimeMs);
    }
  } catch {
    /* reported through lastError below */
  }
  let items = 0;
  try {
    items = (getDb().prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
  } catch {
    /* the count is only used to report drift */
  }
  return {
    enabled: mirrorEnabled(),
    dir: collectionDir(),
    files,
    bytes,
    updatedAt: newest ? new Date(newest).toISOString() : null,
    failures: state.failures,
    lastError: state.lastError,
    items,
  };
}

/**
 * Every file in the folder: the index, the explainer and each item, named
 * relative to the folder and paired with the path to read it from. This is what
 * a "take my inventory elsewhere" download contains. It lists rather than
 * reads, so packaging a large inventory never holds it all in memory.
 */
export function collectionFiles(): Array<{ name: string; path: string; size: number }> {
  flushCollection();
  const out: Array<{ name: string; path: string; size: number }> = [];
  const add = (name: string, file: string) => {
    try {
      out.push({ name, path: file, size: fs.statSync(file).size });
    } catch {
      /* it went away between listing and stat-ing; it simply is not in the archive */
    }
  };
  for (const name of ["README.md", "index.md"]) {
    const file = path.join(collectionDir(), name);
    if (fs.existsSync(file)) add(name, file);
  }
  const dir = itemsDir();
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (name.endsWith(".md")) add(`items/${name}`, path.join(dir, name));
  }
  return out;
}

/** Every item file on disk, as text. Used by the reader and by backups. */
export function readItemFiles(): Array<{ name: string; text: string }> {
  const dir = itemsDir();
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ name: string; text: string }> = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    out.push({ name, text: fs.readFileSync(path.join(dir, name), "utf8") });
  }
  return out;
}
