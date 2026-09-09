import fs from "node:fs";
import path from "node:path";
import { dataDir, getDb } from "../db";
import type { CardRecord, Condition, Game, PriceSnapshot, Sale } from "../types";
import { CONDITIONS, GAMES } from "../types";
import { INDEX_HEADERS, cardFileName, cardMarkdown, idFromFileName } from "./card";
import { money, parseDocument, readMoney, readTable, table } from "./format";

/**
 * A live plain-text copy of the collection.
 *
 * Every card is also a Markdown file on disk, rewritten whenever that card
 * changes. The database stays the thing the app reads, but it is no longer the
 * only place the collection exists: if this app is never updated again, the
 * folder is still a complete, readable catalogue that any text editor, git
 * repository or note-taking tool can open, and that this app can read back.
 *
 * Mirroring must never be the reason a card fails to save, so every write is
 * wrapped: a full disk or a read-only volume degrades the mirror, not the app.
 */

export function collectionDir(): string {
  return path.join(dataDir(), "collection");
}

export function cardsDir(): string {
  return path.join(collectionDir(), "cards");
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

const globalForMirror = globalThis as unknown as { __collectcollectMirror?: MirrorState };
const state: MirrorState = (globalForMirror.__collectcollectMirror ??= {
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

/** Write via a temporary file so a crash mid-write cannot leave half a card. */
function writeAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

function ensureDirs(): void {
  fs.mkdirSync(cardsDir(), { recursive: true });
  // The index is rebuilt on a delay, but whoever opens this folder should
  // always find the note explaining what it is, from the very first card.
  const readme = path.join(collectionDir(), "README.md");
  if (!fs.existsSync(readme)) writeAtomic(readme, README);
}

// ---------------------------------------------------------------------------
// Per-card files
// ---------------------------------------------------------------------------

function salesFor(cardId: number): Sale[] {
  const rows = readRows("SELECT * FROM sales WHERE card_id = ? ORDER BY sold_at DESC, id DESC", cardId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    cardId: Number(r.card_id),
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

function snapshotsFor(cardId: number): PriceSnapshot[] {
  const rows = readRows(
    "SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY fetched_at DESC, id DESC",
    cardId,
  ) as Array<Record<string, unknown>>;
  const out: PriceSnapshot[] = [];
  for (const r of rows) {
    try {
      out.push({ id: Number(r.id), cardId: Number(r.card_id), fetchedAt: String(r.fetched_at), summary: JSON.parse(String(r.summary)) });
    } catch {
      /* a snapshot that will not parse is not worth failing the mirror over */
    }
  }
  return out;
}

/**
 * The mirror reads what it needs straight from the database rather than from
 * the repository that calls it. Keeping it a leaf module is what stops a
 * mirroring problem from ever being able to break a card write.
 */
function readRows(sql: string, ...params: unknown[]): unknown[] {
  return getDb().prepare(sql).all(...(params as never[]));
}

/**
 * Rewrite one card's file. Safe to call for any card, at any time.
 *
 * `mayHaveOldName` says whether this card could already be filed under a
 * different name, which is the only reason to scan the folder for leftovers.
 * A card being created has no history to leave behind, and looking for one
 * would turn adding a thousand cards into a thousand passes over the folder.
 */
export function mirrorCard(card: CardRecord, opts: { mayHaveOldName?: boolean } = {}): void {
  if (!mirrorEnabled()) return;
  try {
    ensureDirs();
    const contents = cardMarkdown({ card, sales: salesFor(card.id), snapshots: snapshotsFor(card.id) });
    const wanted = cardFileName(card);
    const file = path.join(cardsDir(), wanted);
    // If the card already has this file, its name cannot have changed.
    const moved = opts.mayHaveOldName !== false && !fs.existsSync(file);
    writeAtomic(file, contents);
    if (moved) dropStaleFiles(card.id, wanted);
    scheduleIndex();
  } catch (e) {
    note(e);
  }
}

/** A renamed card leaves a file behind under its old slug; take it with us. */
function dropStaleFiles(id: number, keep: string): void {
  for (const name of fs.readdirSync(cardsDir())) {
    if (name !== keep && name.endsWith(".md") && idFromFileName(name) === id) {
      fs.rmSync(path.join(cardsDir(), name), { force: true });
    }
  }
}

export function unmirrorCard(id: number): void {
  if (!mirrorEnabled()) return;
  try {
    if (!fs.existsSync(cardsDir())) return;
    for (const name of fs.readdirSync(cardsDir())) {
      if (name.endsWith(".md") && idFromFileName(name) === id) {
        fs.rmSync(path.join(cardsDir(), name), { force: true });
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
 * The index is built from the card files themselves rather than the database,
 * so what it lists is exactly what is on disk. It is rebuilt shortly after a
 * change instead of on every one, which keeps a thousand-card price refresh
 * from rewriting it a thousand times.
 */
function scheduleIndex(): void {
  const now = Date.now();
  if (!state.indexDirty) state.dirtySince = now;
  state.indexDirty = true;
  if (state.indexTimer) {
    // A refresh of a large collection changes every card in turn; rebuilding
    // the index after each one would read the whole folder over and over.
    if (now - state.dirtySince >= INDEX_MAX_WAIT_MS) return;
    clearTimeout(state.indexTimer);
  }
  state.indexTimer = setTimeout(() => {
    state.indexTimer = null;
    if (state.indexDirty) writeIndex();
  }, INDEX_QUIET_MS);
  state.indexTimer.unref?.();
}

/** Write the index now. Used by tests, by rebuilds, and before a backup. */
export function flushCollection(): void {
  if (state.indexTimer) {
    clearTimeout(state.indexTimer);
    state.indexTimer = null;
  }
  if (state.indexDirty) writeIndex();
}

interface IndexEntry {
  file: string;
  data: Record<string, unknown>;
  value: number | null;
}

function readIndexEntries(): IndexEntry[] {
  const dir = cardsDir();
  if (!fs.existsSync(dir)) return [];
  const entries: IndexEntry[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    try {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, body } = parseDocument(text);
      if (!data.name) continue;
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
      const condition = String(e.data.condition ?? "") as Condition;
      const grade = e.data.grade
        ? `${String(e.data.grading_company ?? "").trim()} ${e.data.grade}`.trim()
        : (CONDITIONS[condition] ?? condition);
      const game = String(e.data.game ?? "") as Game;
      return [
        `[${String(e.data.name ?? "")}](cards/${e.file})`,
        GAMES[game] ?? game,
        String(e.data.set_name ?? ""),
        String(e.data.card_number ?? ""),
        quantity,
        grade,
        String(e.data.location ?? ""),
        worth === null ? "" : money(worth),
      ];
    });

    const doc = [
      "# Collection",
      "",
      `${entries.length} card${entries.length === 1 ? "" : "s"}, ${copies} cop${copies === 1 ? "y" : "ies"}` +
        (total > 0 ? `, last valued at ${money(total)}.` : "."),
      "",
      "Every row links to that card's own file. See [README.md](README.md) for what these files are.",
      "",
      rows.length ? table(INDEX_HEADERS, rows) : "_No cards yet._",
      "",
    ].join("\n");
    writeAtomic(path.join(collectionDir(), "index.md"), doc);
    writeReadme();
    state.indexDirty = false;
  } catch (e) {
    note(e);
  }
}

const README = `# Your collection, in plain text

This folder is a complete copy of a CollectCollect catalogue, written as
Markdown. It exists so the collection outlives the app: if CollectCollect is
never updated again, or you simply want your data somewhere else, everything
you need is here in files any computer can open.

## What is here

- \`index.md\` — every card in one table, with a link to each card's file. It is
  rebuilt shortly after a change rather than instantly, so the card files are
  the ones to trust if the two ever disagree.
- \`cards/\` — one file per card, named \`<id>-<card name>.md\`.
- \`../uploads/\` — the photos, when this folder is sitting in the app's data
  directory. Each card file links to its own photo. The Markdown download does
  not carry them; the full backup in Settings does.

## How to read a card file

Every card file starts with a block between \`---\` lines: the card's record —
name, set,
number, grade, how many copies, what you paid, where it is kept. It is written
as YAML with JSON values, which means both people and programs can read it.

Underneath is the same card written for a person: what it is, its photo, your
notes, every price the app ever recorded for it, and any sales.

## Getting it back into an app

CollectCollect can read this folder back: Settings → "Rebuild from these
files". It matches on the \`id\` in each file, so importing the same folder
twice is safe.

Nothing here needs CollectCollect, though. The front matter is ordinary YAML
and the tables are ordinary Markdown, so a spreadsheet, a script, or a
different cataloguing tool can take it from here.

## What these files do not hold

The per-provider quotes behind each price are left out — the recorded prices
themselves are all here. Photos are not in this folder: they live in
\`uploads\` next to it in the app's data directory, so keep the two together,
and use the full backup rather than the Markdown download if you want both in
one file.
`;

function writeReadme(): void {
  writeAtomic(path.join(collectionDir(), "README.md"), README);
}

// ---------------------------------------------------------------------------
// Rebuild and status
// ---------------------------------------------------------------------------

export interface RebuildResult {
  written: number;
  /** Files describing cards the database does not have. They are left alone. */
  orphans: number;
}

/**
 * Rewrite the whole folder from the database.
 *
 * Files for cards the database does not know about are counted and left
 * where they are. Deleting a card already takes its file with it, so an
 * orphan means the two have come apart — and the likeliest way that happens
 * is someone pointing a fresh, empty install at a folder that is the only
 * copy of their collection left. Rewriting must never be the thing that
 * destroys it; the file is the record here, and only a person should decide
 * it is not wanted.
 */
export function rebuildCollection(cards: CardRecord[]): RebuildResult {
  if (!mirrorEnabled()) return { written: 0, orphans: 0 };
  ensureDirs();
  const keep = new Set<string>();
  let written = 0;
  for (const card of cards) {
    const name = cardFileName(card);
    writeAtomic(path.join(cardsDir(), name), cardMarkdown({ card, sales: salesFor(card.id), snapshots: snapshotsFor(card.id) }));
    keep.add(name);
    written++;
  }
  const known = new Set(cards.map((c) => c.id));
  let orphans = 0;
  for (const name of fs.readdirSync(cardsDir())) {
    // .tmp files are half-written cards left by a crash; they belong to nobody.
    if (name.endsWith(".tmp")) {
      fs.rmSync(path.join(cardsDir(), name), { force: true });
      continue;
    }
    if (!name.endsWith(".md") || keep.has(name)) continue;
    const id = idFromFileName(name);
    // A file left over from a rename of a card that is still here is stale and
    // says so by its id; anything else describes a card this database lost.
    if (id !== null && known.has(id)) fs.rmSync(path.join(cardsDir(), name), { force: true });
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
  /** Cards in the database, so the page can say when the folder has fallen behind. */
  cards: number;
}

export function collectionStatus(): CollectionStatus {
  const dir = cardsDir();
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
  let cards = 0;
  try {
    cards = (getDb().prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n;
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
    cards,
  };
}

/**
 * Every file in the folder: the index, the explainer and each card, named
 * relative to the folder and paired with the path to read it from. This is
 * what a "take my collection elsewhere" download contains. It lists rather
 * than reads, so packaging a large collection never holds it all in memory.
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
  const dir = cardsDir();
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (name.endsWith(".md")) add(`cards/${name}`, path.join(dir, name));
  }
  return out;
}

/** Every card file on disk, as text. Used by the reader and by backups. */
export function readCardFiles(): Array<{ name: string; text: string }> {
  const dir = cardsDir();
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ name: string; text: string }> = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    out.push({ name, text: fs.readFileSync(path.join(dir, name), "utf8") });
  }
  return out;
}
