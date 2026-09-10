import type { Acquisition } from "../acquisitions";
import type {
  AppliedSticker,
  Category,
  Exterior,
  ItemInput,
  ItemRecord,
  PriceSnapshot,
  PriceSummary,
  Rarity,
  Sale,
} from "../types";
import { CATEGORIES, EXTERIORS, RARITIES } from "../types";
import { money, parseDocument, readMoney, readSection, readTable, slug, table, writeFrontMatter } from "@collectcollect/core/markdown/format";

/** Everything about one item that the plain-text copy preserves. */
export interface ItemBundle {
  item: ItemRecord;
  sales: Sale[];
  snapshots: PriceSnapshot[];
  acquisitions: Acquisition[];
  /** Which lots each sale took, keyed by sale id, when that is recorded. */
  saleLots?: Map<number, Array<{ quantity: number; unitCost: number | null; acquiredAt: string | null }>>;
}

export interface ParsedLot {
  quantity: number;
  remaining: number;
  unitCost: number | null;
  acquiredAt: string;
  source: string | null;
  notes: string | null;
}

export interface ParsedSaleLot {
  quantity: number;
  unitCost: number | null;
  /** The day the lot was acquired, which is how it is matched back to one. */
  acquiredOn: string | null;
}

/** What reading one of those files back gives you. */
export interface ParsedItem {
  id: number | null;
  input: ItemInput;
  createdAt: string | null;
  updatedAt: string | null;
  sales: Array<Omit<Sale, "id" | "itemId" | "createdAt"> & { lots: ParsedSaleLot[] }>;
  acquisitions: ParsedLot[];
  snapshots: Array<{ fetchedAt: string; summary: PriceSummary }>;
  warnings: string[];
}

const VALUE_HEADERS = ["Date", "Your copy", "Market", "Basis"];
const ACQUISITION_HEADERS = ["Acquired", "Copies", "Left", "Cost each", "From", "Notes"];
const SALE_HEADERS = ["Sold", "Copies", "Each", "Fees", "Cost each", "Venue", "Notes", "Lots"];
const STICKER_HEADERS = ["Slot", "Sticker", "Wear", "Market name"];

/** `0007-ak-47-redline-field-tested.md` — sorts by intake order and still reads. */
export function itemFileName(item: Pick<ItemRecord, "id" | "marketHashName">): string {
  // ™ and ★ are in half the names in this game. Unicode folding turns ™ into a
  // literal "tm", so "StatTrak™ AWP" would file as "stattraktm-awp"; dropping
  // them first keeps the file name readable.
  const stem = slug(item.marketHashName.replace(/[™★]/g, " "));
  return `${String(item.id).padStart(4, "0")}${stem ? `-${stem}` : ""}.md`;
}

export function idFromFileName(name: string): number | null {
  const match = /^(\d+)(?:-|\.md$)/.exec(name);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Fields that belong on one line. Front matter is JSON so it escapes itself,
 * but a name tag holding a newline would otherwise write a heading or a table
 * row straight into the body and be read back as one.
 */
function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** A float, written so it survives the trip: full precision, no thousands separators. */
function floatText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  // CS2 floats are 32-bit, so ten decimals is more than the source can carry
  // and the trailing zeroes go rather than pad every row.
  return String(Number(value.toFixed(10)));
}

function detail(item: ItemRecord): string {
  const rarity = item.rarity ? RARITIES[item.rarity]?.label : null;
  return [
    CATEGORIES[item.category] ?? item.category,
    item.exterior ? EXTERIORS[item.exterior] : null,
    item.stattrak ? "StatTrak™" : null,
    item.souvenir ? "Souvenir" : null,
    rarity,
    item.collection,
  ]
    .filter(Boolean)
    .map(oneLine)
    .join(" · ");
}

function moneyCell(value: number | null, source: string | null): string {
  if (value === null || value === undefined) return "";
  return `${money(value)}${source ? ` (${source})` : ""}`;
}

/** `2 @ $40.00 (2019-05-02) · 1 @ $120.00 (2021-08-11)` */
function lotsCell(lots: Array<{ quantity: number; unitCost: number | null; acquiredAt: string | null }>): string {
  if (!lots.length) return "";
  return lots
    .map((lot) => {
      const cost = lot.unitCost === null ? "—" : money(lot.unitCost);
      const day = lot.acquiredAt ? ` (${lot.acquiredAt.slice(0, 10)})` : "";
      return `${lot.quantity} @ ${cost}${day}`;
    })
    .join(" · ");
}

const LOT_RE = /^\s*(\d+)\s*@\s*(.*?)\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*$/;

function parseLotsCell(text: string): ParsedSaleLot[] {
  const out: ParsedSaleLot[] = [];
  if (!text) return out;
  for (const part of text.split("·")) {
    const match = LOT_RE.exec(part);
    if (!match) continue;
    const quantity = Number(match[1]);
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    out.push({ quantity, unitCost: readMoney(match[2] ?? ""), acquiredOn: match[3] ?? null });
  }
  return out;
}

// Source labels can carry their own brackets, so the split runs to the last
// bracket rather than the first balanced pair.
const SOURCE_RE = /^(.*?)\s*\((.*)\)\s*$/;

function splitSource(text: string): { rest: string; source: string | null } {
  const match = SOURCE_RE.exec(text.trim());
  if (!match) return { rest: text.trim(), source: null };
  return { rest: match[1].trim(), source: match[2].trim() || null };
}

function escapeProse(text: string): string {
  // A note that starts a line with `#` would otherwise read as a new section.
  // The backslash itself is escaped first, so a note that already contains one
  // comes back as it went in.
  return text
    .replace(/^\\(?=\\*(?:#{1,6}\s|---\s*$))/gm, "\\\\")
    .replace(/^(#{1,6}\s)/gm, "\\$1")
    .replace(/^(---\s*)$/gm, "\\$1");
}

function unescapeProse(text: string): string {
  return text.replace(/^\\(\\*(?:#{1,6}\s|---\s*$))/gm, "$1");
}

/**
 * One item as a Markdown document: front matter holding the facts, prose and
 * tables holding everything a person would want to read. Nothing here needs the
 * app to make sense of it.
 */
export function itemMarkdown(bundle: ItemBundle): string {
  const { item, sales, snapshots, acquisitions, saleLots } = bundle;
  const latest = snapshots.length ? snapshots[0].summary : null;

  const front = writeFrontMatter({
    id: item.id,
    market_hash_name: item.marketHashName,
    category: item.category,
    weapon: item.weapon,
    finish: item.finish,
    exterior: item.exterior,
    rarity: item.rarity,
    collection: item.collection,
    // Left out rather than written as false: almost nothing is StatTrak or
    // Souvenir, and a `false` on every case and sticker file is noise. The
    // reader treats a missing flag as no.
    stattrak: item.stattrak || undefined,
    souvenir: item.souvenir || undefined,
    float: item.floatValue,
    paint_seed: item.paintSeed,
    paint_index: item.paintIndex,
    name_tag: item.nameTag,
    quantity: item.quantity,
    purchase_price: item.purchasePrice,
    asset_id: item.assetId,
    inspect_link: item.inspectLink,
    tradable_after: item.tradableAfter,
    storage_unit: item.storageUnit,
    image_url: item.imageUrl,
    external_ids: item.externalIds,
    manual_price: item.manualPrice,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  });

  // Blocks are joined with exactly one blank line between them, rather than
  // squeezed afterwards: collapsing the finished document would also flatten
  // the blank lines inside somebody's notes.
  const blocks: string[] = [];
  blocks.push(`# ${oneLine(item.marketHashName)}`);
  blocks.push(detail(item));

  const facts: string[] = [];
  if (item.stackable) facts.push(`**${item.quantity}** ${item.quantity === 1 ? "copy" : "copies"}`);
  if (item.floatValue !== null) facts.push(`float ${floatText(item.floatValue)}`);
  if (item.paintSeed !== null) facts.push(`pattern ${item.paintSeed}`);
  if (item.nameTag) facts.push(`named “${oneLine(item.nameTag)}”`);
  if (item.storageUnit) facts.push(`kept in ${oneLine(item.storageUnit)}`);
  if (item.tradableAfter) facts.push(`trade locked until ${item.tradableAfter.slice(0, 10)}`);
  if (facts.length) blocks.push(facts.join(" · "));

  const value = latest?.yourCopyValue ?? null;
  if (value !== null || item.purchasePrice !== null) {
    const bits: string[] = [];
    if (value !== null) {
      bits.push(
        `Last valued at **${money(value)}**${item.quantity > 1 ? ` per copy (${money(value * item.quantity)} in total)` : ""}.`,
      );
      // The basis is a phrase, not a sentence, so it needs a stop of its own
      // before the next one starts.
      if (latest?.yourCopyBasis) bits.push(/[.!?]$/.test(latest.yourCopyBasis) ? latest.yourCopyBasis : `${latest.yourCopyBasis}.`);
      bits.push(`Priced ${snapshots[0].fetchedAt.slice(0, 10)}.`);
    }
    if (item.purchasePrice !== null) bits.push(`Paid ${money(item.purchasePrice)}${item.quantity > 1 ? " per copy" : ""}.`);
    blocks.push(bits.join(" "));
  }

  if (item.imageUrl) {
    blocks.push("## Image", `![${oneLine(item.marketHashName)}](${item.imageUrl})`);
  }

  if (item.stickers.length) {
    blocks.push(
      "## Stickers",
      table(
        STICKER_HEADERS,
        item.stickers.map((s) => [s.slot, s.name, s.wear === null ? "" : floatText(s.wear), s.marketHashName ?? ""]),
      ),
    );
  }

  if (item.notes?.trim()) {
    blocks.push("## Notes", escapeProse(item.notes.trim()));
  }

  if (snapshots.length) {
    blocks.push(
      "## Value history",
      table(
        VALUE_HEADERS,
        snapshots.map((s) => [
          s.fetchedAt,
          s.summary.yourCopyValue === null ? "" : money(s.summary.yourCopyValue),
          moneyCell(s.summary.market, s.summary.marketSource),
          s.summary.yourCopyBasis ?? "",
        ]),
      ),
    );
  }

  if (acquisitions.length) {
    blocks.push(
      "## Acquisitions",
      table(
        ACQUISITION_HEADERS,
        acquisitions.map((a) => [
          a.acquiredAt,
          a.quantity,
          a.remaining,
          // An unrecorded cost writes as an em dash and reads back as "not
          // known", which is a different thing from an item that was free.
          a.unitCost === null ? "" : money(a.unitCost),
          a.source ?? "",
          a.notes ?? "",
        ]),
      ),
    );
  }

  if (sales.length) {
    blocks.push(
      "## Sales",
      table(
        SALE_HEADERS,
        sales.map((s) => [
          s.soldAt,
          s.quantity,
          money(s.unitPrice),
          money(s.fees),
          s.unitCost === null ? "" : money(s.unitCost),
          s.venue ?? "",
          s.notes ?? "",
          lotsCell(saleLots?.get(s.id) ?? []),
        ]),
      ),
    );
  }

  return `${front}\n${blocks.filter((b) => b.trim()).join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = str(value)?.toLowerCase();
  return text === "true" || text === "yes" || text === "1";
}

function record(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "__proto__") continue;
    const text = str(v);
    if (text) out[k] = text;
  }
  return out;
}

/**
 * Read one item file. Returns null only when the file is not an item at all;
 * anything else that is wrong costs a warning, never the item. The point of
 * these files is to survive, which means a mangled row loses that row.
 */
export function parseItemMarkdown(text: string): ParsedItem | null {
  const { data, body } = parseDocument(text);
  // Every item file carries front matter. Without it this is prose that happens
  // to have a title — the folder's own README, most likely — and reading it as
  // an item would invent one.
  if (Object.keys(data).length === 0) return null;
  const marketHashName = str(data.market_hash_name) ?? str(/^#\s+(.*)$/m.exec(body)?.[1]);
  if (!marketHashName) return null;
  const warnings: string[] = [];

  const rawCategory = (str(data.category) ?? "other").toLowerCase();
  const category = (Object.hasOwn(CATEGORIES, rawCategory) ? rawCategory : "other") as Category;
  if (category !== rawCategory) warnings.push(`Unknown category "${rawCategory}", filed under Other`);

  const rawExterior = str(data.exterior)?.toLowerCase() ?? null;
  let exterior: Exterior | null = null;
  if (rawExterior !== null) {
    if (Object.hasOwn(EXTERIORS, rawExterior)) exterior = rawExterior as Exterior;
    else warnings.push(`Unknown exterior "${rawExterior}", left blank`);
  }

  const rawRarity = str(data.rarity)?.toLowerCase() ?? null;
  let rarity: Rarity | null = null;
  if (rawRarity !== null) {
    if (Object.hasOwn(RARITIES, rawRarity)) rarity = rawRarity as Rarity;
    else warnings.push(`Unknown rarity "${rawRarity}", left blank`);
  }

  const stickers: AppliedSticker[] = [];
  for (const row of readTable(body, "Stickers")) {
    const [slot, name, wear, market] = row;
    if (!name) {
      warnings.push(`Skipped an unreadable sticker row: ${row.join(" | ")}`);
      continue;
    }
    stickers.push({
      slot: Math.max(0, Math.round(num(slot) ?? stickers.length)),
      name,
      marketHashName: market || null,
      wear: num(wear),
    });
  }

  const notesSection = readSection(body, "Notes");
  const quantity = num(data.quantity);
  const input: ItemInput = {
    marketHashName,
    category,
    weapon: str(data.weapon),
    finish: str(data.finish),
    exterior,
    rarity,
    collection: str(data.collection),
    stattrak: bool(data.stattrak),
    souvenir: bool(data.souvenir),
    floatValue: num(data.float),
    paintSeed: num(data.paint_seed),
    paintIndex: num(data.paint_index),
    nameTag: str(data.name_tag),
    quantity: quantity === null ? 1 : Math.max(0, Math.round(quantity)),
    purchasePrice: num(data.purchase_price),
    assetId: str(data.asset_id),
    inspectLink: str(data.inspect_link),
    tradableAfter: str(data.tradable_after),
    storageUnit: str(data.storage_unit),
    imageUrl: str(data.image_url),
    notes: notesSection ? unescapeProse(notesSection) : null,
    externalIds: record(data.external_ids),
    manualPrice: num(data.manual_price),
    stickers,
  };

  const sales: ParsedItem["sales"] = [];
  for (const row of readTable(body, "Sales")) {
    const [soldAt, copies, each, fees, cost, venue, notes] = row;
    const unitPrice = readMoney(each);
    const quantitySold = num(copies);
    if (!soldAt || unitPrice === null || quantitySold === null || quantitySold < 1) {
      warnings.push(`Skipped an unreadable sale row: ${row.join(" | ")}`);
      continue;
    }
    sales.push({
      quantity: Math.round(quantitySold),
      unitPrice,
      fees: readMoney(fees) ?? 0,
      unitCost: readMoney(cost),
      soldAt,
      venue: venue || null,
      notes: notes || null,
      lots: parseLotsCell(row[7] ?? ""),
    });
  }

  const acquisitions: ParsedLot[] = [];
  const lotSection = readSection(body, "Acquisitions");
  for (const row of readTable(body, "Acquisitions")) {
    const [acquiredAt, copies, left, cost, source, lotNotes] = row;
    const lotQuantity = num(copies);
    if (!acquiredAt || Number.isNaN(Date.parse(acquiredAt)) || lotQuantity === null || lotQuantity < 1) {
      warnings.push(`Skipped an unreadable purchase row: ${row.join(" | ")}`);
      continue;
    }
    const remaining = num(left);
    acquisitions.push({
      quantity: Math.round(lotQuantity),
      remaining:
        remaining === null ? Math.round(lotQuantity) : Math.max(0, Math.min(Math.round(lotQuantity), Math.round(remaining))),
      unitCost: readMoney(cost ?? ""),
      acquiredAt,
      source: source || null,
      notes: lotNotes || null,
    });
  }
  if (lotSection === null && (input.quantity ?? 0) > 0) {
    // A file with no purchase table still knows how many copies there are and
    // what they cost on average, which is exactly one lot's worth of
    // information. Reading it as nothing would lose the cost basis entirely.
    acquisitions.push({
      quantity: input.quantity!,
      remaining: input.quantity!,
      unitCost: input.purchasePrice ?? null,
      acquiredAt: str(data.created_at) ?? str(data.updated_at) ?? new Date(0).toISOString(),
      source: null,
      notes: null,
    });
  }

  const snapshots: ParsedItem["snapshots"] = [];
  for (const row of readTable(body, "Value history")) {
    const [fetchedAt, yourCopy, marketCell, basis] = row;
    if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) {
      warnings.push(`Skipped a price row with no readable date: ${row.join(" | ")}`);
      continue;
    }
    const market = splitSource(marketCell ?? "");
    snapshots.push({
      fetchedAt,
      summary: {
        currency: "USD",
        fetchedAt,
        market: readMoney(market.rest),
        marketSource: market.source,
        yourCopyValue: readMoney(yourCopy ?? ""),
        yourCopyBasis: basis ?? "",
        quotes: [],
        errors: [],
      },
    });
  }

  const rawId = num(data.id);
  // SQLite hands rowids back through a double, so stay well inside what one
  // represents exactly; a 32-bit id is more than any inventory needs.
  const id = rawId !== null && rawId >= 1 && rawId <= 2 ** 31 - 1 ? Math.round(rawId) : null;
  if (rawId !== null && id === null) warnings.push(`Ignored an id outside the usable range: ${rawId}`);

  return { id, input, createdAt: str(data.created_at), updatedAt: str(data.updated_at), sales, acquisitions, snapshots, warnings };
}

export const INDEX_HEADERS = ["Item", "Kind", "Exterior", "Float", "Copies", "Kept in", "Value"];
