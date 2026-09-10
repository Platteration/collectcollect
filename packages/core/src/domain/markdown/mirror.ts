import fs from "node:fs";
import path from "node:path";
import type { Ledger } from "../acquisitions";
import type { DomainDb } from "../db";
import { money, table } from "../../markdown/format";
import type { DomainSpec, ItemRecord, PriceSnapshot, PriceSummary, Sale } from "../spec";
import { itemFileName, itemMarkdown, idFromFileName, parseItemMarkdown, recordFromInput, displayValue, type ItemBundle } from "./document";

/**
 * A live plain-text copy of the collection.
 *
 * Every item is also a Markdown file on disk, rewritten whenever that item
 * changes. The database stays the thing the app reads, but it is no longer the
 * only place the collection exists: if the app is never updated again, the
 * folder is still a complete, readable catalogue that any text editor, git
 * repository or note-taking tool can open, and that the app can read back.
 *
 * Mirroring must never be the reason an item fails to save, so every write is
 * wrapped: a full disk or a read-only volume degrades the mirror, not the app.
 */

export interface MirrorState {
  lastError: string | null;
  failures: number;
  indexTimer: NodeJS.Timeout | null;
  indexDirty: boolean;
  dirtySince: number;
}

export interface RebuildResult {
  written: number;
  /** Files describing items the database does not have. They are left alone. */
  orphans: number;
}

export interface CollectionStatus {
  enabled: boolean;
  dir: string;
  files: number;
  bytes: number;
  updatedAt: string | null;
  failures: number;
  lastError: string | null;
  items: number;
}

const INDEX_QUIET_MS = 750;
const INDEX_MAX_WAIT_MS = 15_000;

export type Mirror<F extends object> = ReturnType<typeof createMirror<F, object, object>>;

export function createMirror<F extends object, S extends object, X extends object>(ctx: {
  spec: DomainSpec<F, S, X, unknown>;
  db: DomainDb;
  ledger: Ledger;
  includePrivate: () => boolean;
}) {
  const { spec, db, ledger } = ctx;
  const folder = spec.folder ?? spec.noun.plural;
  const stateKey = `__collectcollect_mirror_${spec.id.replace(/[^a-z0-9]/gi, "_")}`;
  const store = globalThis as unknown as Record<string, MirrorState | undefined>;
  const state: MirrorState = (store[stateKey] ??= { lastError: null, failures: 0, indexTimer: null, indexDirty: false, dirtySince: 0 });

  const collectionDir = () => path.join(db.dataDir(), "collection");
  const itemsDir = () => path.join(collectionDir(), folder);
  const mirrorEnabled = () => (process.env.MARKDOWN_MIRROR ?? "on").toLowerCase() !== "off";

  function note(e: unknown): void {
    state.failures += 1;
    state.lastError = e instanceof Error ? e.message : String(e);
  }

  function writeAtomic(file: string, contents: string): void {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, contents, "utf8");
    fs.renameSync(tmp, file);
  }

  function ensureDirs(): void {
    fs.mkdirSync(itemsDir(), { recursive: true });
    const readme = path.join(collectionDir(), "README.md");
    if (!fs.existsSync(readme)) writeAtomic(readme, readmeText());
  }

  function readRows(sql: string, ...params: unknown[]): unknown[] {
    return db.getDb().prepare(sql).all(...(params as never[]));
  }

  function salesFor(itemId: number): Sale[] {
    const rows = readRows("SELECT * FROM sales WHERE item_id = ? ORDER BY sold_at DESC, id DESC", itemId) as Array<Record<string, unknown>>;
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

  function saleLotsFor(itemId: number, sales: Sale[]) {
    const lots = new Map(ledger.listLots(itemId).map((lot) => [lot.id, lot]));
    const out = new Map<number, Array<{ quantity: number; unitCost: number | null; acquiredAt: string | null }>>();
    for (const sale of sales) {
      const consumed = ledger.listSaleLots(sale.id).map((c) => ({
        quantity: c.quantity,
        unitCost: c.unitCost,
        acquiredAt: c.acquisitionId === null ? null : (lots.get(c.acquisitionId)?.acquiredAt ?? null),
      }));
      if (consumed.length) out.set(sale.id, consumed);
    }
    return out;
  }

  function snapshotsFor(itemId: number): PriceSnapshot<X>[] {
    const rows = readRows("SELECT * FROM price_snapshots WHERE item_id = ? ORDER BY fetched_at DESC, id DESC", itemId) as Array<Record<string, unknown>>;
    const out: PriceSnapshot<X>[] = [];
    for (const r of rows) {
      try {
        out.push({ id: Number(r.id), itemId: Number(r.item_id), fetchedAt: String(r.fetched_at), summary: JSON.parse(String(r.summary)) as PriceSummary<X> });
      } catch {
        /* a snapshot that will not parse is not worth failing the mirror over */
      }
    }
    return out;
  }

  function bundleFor(item: ItemRecord<F>): ItemBundle<F, X> {
    const sales = salesFor(item.id);
    return { item, sales, snapshots: snapshotsFor(item.id), acquisitions: ledger.listLots(item.id), saleLots: saleLotsFor(item.id, sales) };
  }

  function render(item: ItemRecord<F>): string {
    return itemMarkdown(spec, bundleFor(item), { includePrivate: ctx.includePrivate(), describe: spec.pricing.describe });
  }

  function mirrorItem(item: ItemRecord<F>, opts: { mayHaveOldName?: boolean } = {}): void {
    if (!mirrorEnabled()) return;
    try {
      ensureDirs();
      const contents = render(item);
      const wanted = itemFileName(spec, item);
      const file = path.join(itemsDir(), wanted);
      const moved = opts.mayHaveOldName !== false && !fs.existsSync(file);
      writeAtomic(file, contents);
      if (moved) dropStaleFiles(item.id, wanted);
      scheduleIndex();
    } catch (e) {
      note(e);
    }
  }

  function dropStaleFiles(id: number, keep: string): void {
    for (const name of fs.readdirSync(itemsDir())) {
      if (name !== keep && name.endsWith(".md") && idFromFileName(name) === id) fs.rmSync(path.join(itemsDir(), name), { force: true });
    }
  }

  function unmirrorItem(id: number): void {
    if (!mirrorEnabled()) return;
    try {
      if (!fs.existsSync(itemsDir())) return;
      for (const name of fs.readdirSync(itemsDir())) {
        if (name.endsWith(".md") && idFromFileName(name) === id) fs.rmSync(path.join(itemsDir(), name), { force: true });
      }
      scheduleIndex();
    } catch (e) {
      note(e);
    }
  }

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

  function flushCollection(): void {
    if (state.indexTimer) {
      clearTimeout(state.indexTimer);
      state.indexTimer = null;
    }
    writeIndex();
  }

  function writeIndex(): void {
    if (!mirrorEnabled()) return;
    try {
      ensureDirs();
      const dir = itemsDir();
      let total = 0;
      let copies = 0;
      const rows: unknown[][] = [];
      const extra = spec.markdown?.index ?? [];
      for (const file of fs.readdirSync(dir).sort()) {
        if (!file.endsWith(".md")) continue;
        try {
          const parsed = parseItemMarkdown(spec, fs.readFileSync(path.join(dir, file), "utf8"));
          if (!parsed) continue;
          const item = recordFromInput<F>(spec, parsed.input, parsed.id ?? 0);
          const latest = parsed.snapshots[0]?.yourCopyValue ?? null;
          const worth = latest === null ? null : latest * item.quantity;
          if (worth !== null) total += worth;
          copies += item.quantity;
          rows.push([
            `[${spec.title(item)}](${folder}/${file})`,
            ...extra.map((c) => displayValue(spec, c.field, (item as Record<string, unknown>)[c.field])),
            spec.conditionLabel(item),
            item.quantity,
            item.location ?? "",
            worth === null ? "" : money(worth),
          ]);
        } catch {
          /* skip a file we cannot read rather than lose the whole index */
        }
      }
      const headers = [capitalize(spec.noun.singular), ...extra.map((c) => c.header), "Condition", "Copies", "Kept in", "Value"];
      const doc = [
        `# ${capitalize(spec.noun.plural)}`,
        "",
        `${rows.length} ${rows.length === 1 ? spec.noun.singular : spec.noun.plural}, ${copies} cop${copies === 1 ? "y" : "ies"}` + (total > 0 ? `, last valued at ${money(total)}.` : "."),
        "",
        `Every row links to that ${spec.noun.singular}'s own file. See [README.md](README.md) for what these files are.`,
        "",
        rows.length ? table(headers, rows) : "_Nothing here yet._",
        "",
      ].join("\n");
      writeAtomic(path.join(collectionDir(), "index.md"), doc);
      writeAtomic(path.join(collectionDir(), "README.md"), readmeText());
      state.indexDirty = false;
    } catch (e) {
      note(e);
    }
  }

  function readmeText(): string {
    return spec.markdown?.readme ?? defaultReadme(spec.name, spec.noun, folder);
  }

  function rebuildCollection(items: ItemRecord<F>[]): RebuildResult {
    if (!mirrorEnabled()) return { written: 0, orphans: 0 };
    ensureDirs();
    const keep = new Set<string>();
    let written = 0;
    for (const item of items) {
      const name = itemFileName(spec, item);
      writeAtomic(path.join(itemsDir(), name), render(item));
      keep.add(name);
      written++;
    }
    const known = new Set(items.map((i) => i.id));
    let orphans = 0;
    for (const name of fs.readdirSync(itemsDir())) {
      if (name.endsWith(".tmp")) {
        fs.rmSync(path.join(itemsDir(), name), { force: true });
        continue;
      }
      if (!name.endsWith(".md") || keep.has(name)) continue;
      const id = idFromFileName(name);
      if (id !== null && known.has(id)) fs.rmSync(path.join(itemsDir(), name), { force: true });
      else orphans++;
    }
    state.indexDirty = true;
    flushCollection();
    state.lastError = null;
    state.failures = 0;
    return { written, orphans };
  }

  function collectionStatus(): CollectionStatus {
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
      items = (db.getDb().prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
    } catch {
      /* the count is only used to report drift */
    }
    return { enabled: mirrorEnabled(), dir: collectionDir(), files, bytes, updatedAt: newest ? new Date(newest).toISOString() : null, failures: state.failures, lastError: state.lastError, items };
  }

  /** Every file in the folder, named relative to it and paired with the path to read it from. */
  function collectionFiles(): Array<{ name: string; path: string; size: number }> {
    flushCollection();
    const out: Array<{ name: string; path: string; size: number }> = [];
    const add = (name: string, file: string) => {
      try {
        out.push({ name, path: file, size: fs.statSync(file).size });
      } catch {
        /* went away between listing and stat-ing */
      }
    };
    for (const name of ["README.md", "index.md"]) {
      const file = path.join(collectionDir(), name);
      if (fs.existsSync(file)) add(name, file);
    }
    const dir = itemsDir();
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
      if (name.endsWith(".md")) add(`${folder}/${name}`, path.join(dir, name));
    }
    return out;
  }

  function readItemFiles(): Array<{ name: string; text: string }> {
    const dir = itemsDir();
    if (!fs.existsSync(dir)) return [];
    const out: Array<{ name: string; text: string }> = [];
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".md")) continue;
      out.push({ name, text: fs.readFileSync(path.join(dir, name), "utf8") });
    }
    return out;
  }

  return {
    folder,
    collectionDir,
    itemsDir,
    mirrorEnabled,
    mirrorItem,
    unmirrorItem,
    flushCollection,
    rebuildCollection,
    collectionStatus,
    collectionFiles,
    readItemFiles,
    render,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function defaultReadme(name: string, noun: { singular: string; plural: string }, folder: string): string {
  return `# Your ${noun.plural}, in plain text

This folder is a complete copy of a CollectCollect ${name} collection, written
as Markdown. It exists so the collection outlives the app: if CollectCollect is
never updated again, or you simply want your data somewhere else, everything
you need is here in files any computer can open.

## What is here

- \`index.md\` — every ${noun.singular} in one table, with a link to its own file. It is
  rebuilt shortly after a change rather than instantly, so the ${noun.singular} files are
  the ones to trust if the two ever disagree.
- \`${folder}/\` — one file per ${noun.singular}, named \`<id>-<name>.md\`.
- \`../uploads/\` — the photos, when this folder is sitting in the app's data
  directory. Each file links to its own photos. The Markdown download does not
  carry them; the full backup in Settings does.

## How to read a file

Every file starts with a block between \`---\` lines: the record — what it is,
how many copies, what you paid, where it is kept. It is written as YAML with
JSON values, which means both people and programs can read it.

Underneath is the same ${noun.singular} written for a person: what it is, its photos, your
notes, every value the app ever recorded for it, what each copy cost, and any
sales.

## Purchases and sales

The \`Acquisitions\` table is one row per purchase: when you got the copies, how
many, how many of those you still have, and what each one cost. A cost of
\`—\` means nobody recorded what those copies cost, which is a different thing
from a ${noun.singular} that was free (that reads \`$0.00\`).

Sales are matched to them: the \`Lots\` column on a sale says which purchase each
sold copy came out of, so the profit on a sale is measured against what that
particular copy cost rather than an average. Copies are sold oldest first.

The \`purchase_price\` in the block at the top is the average across the copies
you still hold, worked out from these rows.

## Getting it back into an app

CollectCollect can read this folder back: Settings → "Rebuild from these
files". It matches on the \`id\` in each file, so importing the same folder
twice is safe.

Nothing here needs CollectCollect, though. The front matter is ordinary YAML
and the tables are ordinary Markdown, so a spreadsheet, a script, or a
different cataloguing tool can take it from here.

## What these files do not hold

Fields marked private in the app (a serial number, say) are left out unless
you switched on writing them in Settings. The per-source quotes behind each
recorded value are summarised as text rather than kept in full.
`;
}
