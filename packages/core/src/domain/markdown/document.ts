import type { Acquisition } from "../acquisitions";
import { money, parseDocument, readFenced, readMoney, readSection, readTable, slug, table, writeFrontMatter } from "../../markdown/format";
import { bool, num, str } from "../normalize";
import type { DomainSpec, Identification, ItemInput, ItemRecord, PriceSnapshot, PriceSummary, Sale } from "../spec";
import { columnOf, optionLabel } from "../spec";

/**
 * One item as a Markdown document, and reading it back.
 *
 * Front matter holds the record — every field of the spec by its snake-case
 * key, plus the base fields — and the prose beneath is the same thing written
 * for a person: what it is, its photos, the owner's notes, every recorded
 * value, every purchase and every sale. Nothing here needs the app to make
 * sense of it.
 */

export interface ItemBundle<F extends object, X extends object> {
  item: ItemRecord<F>;
  sales: Sale[];
  snapshots: PriceSnapshot<X>[];
  acquisitions: Acquisition[];
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
  acquiredOn: string | null;
}

export interface ParsedSnapshot {
  fetchedAt: string;
  yourCopyValue: number | null;
  yourCopyBasis: string;
  /** The per-source detail as written, which the domain's summary shape may not be rebuilt from. */
  detail: string;
}

export interface ParsedItem<F extends object> {
  id: number | null;
  input: ItemInput<F>;
  createdAt: string | null;
  updatedAt: string | null;
  sales: Array<Omit<Sale, "id" | "itemId" | "createdAt"> & { lots: ParsedSaleLot[] }>;
  acquisitions: ParsedLot[];
  snapshots: ParsedSnapshot[];
  warnings: string[];
}

const VALUE_HEADERS = ["Date", "Your copy", "Basis", "Sources"];
const ACQUISITION_HEADERS = ["Acquired", "Copies", "Left", "Cost each", "From", "Notes"];
const SALE_HEADERS = ["Sold", "Copies", "Each", "Fees", "Cost each", "Venue", "Notes", "Lots"];

export function itemFileName<F extends object>(spec: Pick<DomainSpec<F>, "title">, item: ItemRecord<F>): string {
  const stem = slug(spec.title(item).replace(/[™★®]/g, " "));
  return `${String(item.id).padStart(4, "0")}${stem ? `-${stem}` : ""}.md`;
}

export function idFromFileName(name: string): number | null {
  const match = /^(\d+)(?:-|\.md$)/.exec(name);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function lotsCell(lots: Array<{ quantity: number; unitCost: number | null; acquiredAt: string | null }>): string {
  if (!lots.length) return "";
  return lots
    .map((lot) => `${lot.quantity} @ ${lot.unitCost === null ? "—" : money(lot.unitCost)}${lot.acquiredAt ? ` (${lot.acquiredAt.slice(0, 10)})` : ""}`)
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

function escapeProse(text: string): string {
  return text
    .replace(/^\\(?=\\*(?:#{1,6}\s|---\s*$))/gm, "\\\\")
    .replace(/^(#{1,6}\s)/gm, "\\$1")
    .replace(/^(---\s*)$/gm, "\\$1");
}

function unescapeProse(text: string): string {
  return text.replace(/^\\(\\*(?:#{1,6}\s|---\s*$))/gm, "$1");
}

/** Which fields a document may carry: private ones only when the owner opted in. */
export function visibleFields<F extends object>(spec: Pick<DomainSpec<F>, "fields">, includePrivate: boolean) {
  return spec.fields.filter((f) => includePrivate || !f.private);
}

export interface DocumentOptions<X extends object> {
  includePrivate?: boolean;
  photoHref?: (name: string) => string;
  describe?: (summary: PriceSummary<X>) => string;
}

export function itemMarkdown<F extends object, X extends object>(
  spec: Pick<DomainSpec<F, object, X>, "fields" | "title" | "detail" | "conditionLabel" | "isUnique" | "markdown">,
  bundle: ItemBundle<F, X>,
  opts: DocumentOptions<X> = {},
): string {
  const { item, sales, snapshots, acquisitions, saleLots } = bundle;
  const latest = snapshots.length ? snapshots[0].summary : null;
  const photoHref = opts.photoHref ?? ((name: string) => `../uploads/${name}`);
  const values = item as unknown as Record<string, unknown>;

  const front: Record<string, unknown> = { id: item.id };
  for (const field of visibleFields(spec, opts.includePrivate ?? false)) {
    const v = values[field.key];
    // A false flag is left out rather than written on every file; the reader
    // treats a missing flag as no.
    front[columnOf(field.key)] = field.type === "boolean" ? v || undefined : v;
  }
  Object.assign(front, {
    quantity: item.quantity,
    purchase_price: item.purchasePrice,
    location: item.location,
    photos: item.photos,
    reference_image_url: item.referenceImageUrl,
    accent_color: item.accentColor,
    external_ids: item.externalIds,
    manual_value: item.manualValue,
    manual_prices: item.manualPrices,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  });

  const blocks: string[] = [];
  const title = oneLine(spec.title(item));
  blocks.push(`# ${title}`);
  const detail = oneLine(spec.detail(item));
  if (detail) blocks.push(detail);

  const unique = spec.isUnique(item);
  blocks.push(
    [
      unique ? "One specific object" : `**${item.quantity}** cop${item.quantity === 1 ? "y" : "ies"}`,
      oneLine(spec.conditionLabel(item)),
      item.location ? `kept in ${oneLine(item.location)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const value = latest?.yourCopyValue ?? null;
  if (value !== null || item.purchasePrice !== null) {
    const bits: string[] = [];
    if (value !== null) {
      bits.push(`Last valued at **${money(value)}**${item.quantity > 1 ? ` per copy (${money(value * item.quantity)} in total)` : ""}.`);
      if (latest?.yourCopyBasis) bits.push(/[.!?]$/.test(latest.yourCopyBasis) ? latest.yourCopyBasis : `${latest.yourCopyBasis}.`);
      bits.push(`Priced ${snapshots[0].fetchedAt.slice(0, 10)}.`);
    }
    if (item.purchasePrice !== null) bits.push(`Paid ${money(item.purchasePrice)}${item.quantity > 1 ? " per copy" : ""}.`);
    blocks.push(bits.join(" "));
  }

  if (item.photos.length) {
    blocks.push("## Photos", item.photos.map((p) => `![${title}](${photoHref(p)})`).join("\n\n"));
  } else if (item.referenceImageUrl) {
    blocks.push("## Photos", `Reference image: <${item.referenceImageUrl}>`);
  }

  if (item.notes?.trim()) blocks.push("## Notes", escapeProse(item.notes.trim()));

  for (const section of spec.markdown?.sections?.(item) ?? []) {
    if (section.body.trim()) blocks.push(`## ${oneLine(section.heading)}`, section.body);
  }

  if (snapshots.length) {
    blocks.push(
      "## Value history",
      table(
        VALUE_HEADERS,
        snapshots.map((s) => [
          s.fetchedAt,
          s.summary.yourCopyValue === null ? "" : money(s.summary.yourCopyValue),
          s.summary.yourCopyBasis ?? "",
          opts.describe ? opts.describe(s.summary) : "",
        ]),
      ),
    );
  }

  if (acquisitions.length) {
    blocks.push(
      "## Acquisitions",
      table(
        ACQUISITION_HEADERS,
        acquisitions.map((a) => [a.acquiredAt, a.quantity, a.remaining, a.unitCost === null ? "" : money(a.unitCost), a.source ?? "", a.notes ?? ""]),
      ),
    );
  }

  if (sales.length) {
    blocks.push(
      "## Sales",
      table(
        SALE_HEADERS,
        sales.map((s) => [s.soldAt, s.quantity, money(s.unitPrice), money(s.fees), s.unitCost === null ? "" : money(s.unitCost), s.venue ?? "", s.notes ?? "", lotsCell(saleLots?.get(s.id) ?? [])]),
      ),
    );
  }

  if (item.identification) {
    blocks.push(
      "## Identification",
      `Read from the photo by the app, confidence ${Math.round((item.identification.confidence ?? 0) * 100)}%.`,
      ["```json", JSON.stringify(item.identification, null, 2), "```"].join("\n"),
    );
  }

  return `${front && writeFrontMatter(front)}\n${blocks.filter((b) => b.trim()).join("\n\n")}\n`;
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

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "__proto__") continue;
    const n = num(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

/** A field's front-matter value as the input type the normaliser expects. Lenient: bad values become null. */
export function readFieldValue(field: { type: string }, raw: unknown): unknown {
  switch (field.type) {
    case "boolean":
      return bool(raw);
    case "number":
    case "integer":
      return num(raw);
    case "list":
      return Array.isArray(raw) ? raw.map(String) : str(raw) ? String(raw).split(/[;|]/).map((s) => s.trim()) : [];
    case "json":
      return raw ?? null;
    default:
      return str(raw);
  }
}

/**
 * Read one item file. Returns null only when the file is not an item at all;
 * anything else that is wrong costs a warning, never the item.
 */
export function parseItemMarkdown<F extends object>(spec: Pick<DomainSpec<F, object, object, unknown>, "fields" | "titleField">, text: string): ParsedItem<F> | null {
  const { data, body } = parseDocument(text);
  if (Object.keys(data).length === 0) return null;
  const warnings: string[] = [];
  const domain: Record<string, unknown> = {};
  for (const field of spec.fields) domain[field.key] = readFieldValue(field, data[columnOf(field.key)]);
  const title = str(domain[spec.titleField]) ?? str(/^#\s+(.*)$/m.exec(body)?.[1]);
  if (!title) return null;
  domain[spec.titleField] = title;

  let identification: Identification | null = null;
  const identificationJson = readFenced(body, "Identification");
  if (identificationJson) {
    try {
      const parsed = JSON.parse(identificationJson) as Identification;
      if (parsed && typeof parsed === "object" && typeof parsed.confidence === "number") identification = parsed;
      else warnings.push("The identification block did not describe an identification and was dropped");
    } catch {
      warnings.push("The identification block was not readable JSON and was dropped");
    }
  }

  const notesSection = readSection(body, "Notes");
  const quantity = num(data.quantity);
  const photos = Array.isArray(data.photos) ? data.photos.map(String) : [];
  const input = {
    ...(domain as Partial<F>),
    quantity: quantity === null ? 1 : Math.max(0, Math.round(quantity)),
    purchasePrice: num(data.purchase_price),
    notes: notesSection ? unescapeProse(notesSection) : null,
    location: str(data.location),
    photos,
    referenceImageUrl: str(data.reference_image_url),
    accentColor: str(data.accent_color),
    externalIds: record(data.external_ids),
    identification,
    manualValue: num(data.manual_value),
    manualPrices: numberRecord(data.manual_prices),
  } as ItemInput<F>;

  const sales: ParsedItem<F>["sales"] = [];
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
      remaining: remaining === null ? Math.round(lotQuantity) : Math.max(0, Math.min(Math.round(lotQuantity), Math.round(remaining))),
      unitCost: readMoney(cost ?? ""),
      acquiredAt,
      source: source || null,
      notes: lotNotes || null,
    });
  }
  if (lotSection === null && (input.quantity ?? 0) > 0) {
    // A file with no purchase table still knows how many copies there are and
    // what they cost on average, which is exactly one lot's worth of information.
    acquisitions.push({
      quantity: input.quantity!,
      remaining: input.quantity!,
      unitCost: input.purchasePrice ?? null,
      acquiredAt: str(data.created_at) ?? str(data.updated_at) ?? new Date(0).toISOString(),
      source: null,
      notes: null,
    });
  }

  const snapshots: ParsedSnapshot[] = [];
  for (const row of readTable(body, "Value history")) {
    const [fetchedAt, yourCopy, basis, detail] = row;
    if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) {
      warnings.push(`Skipped a price row with no readable date: ${row.join(" | ")}`);
      continue;
    }
    snapshots.push({ fetchedAt, yourCopyValue: readMoney(yourCopy ?? ""), yourCopyBasis: basis ?? "", detail: detail ?? "" });
  }

  const rawId = num(data.id);
  const id = rawId !== null && rawId >= 1 && rawId <= 2 ** 31 - 1 ? Math.round(rawId) : null;
  if (rawId !== null && id === null) warnings.push(`Ignored an id outside the usable range: ${rawId}`);

  return { id, input, createdAt: str(data.created_at), updatedAt: str(data.updated_at), sales, acquisitions, snapshots, warnings };
}

/** A record built leniently from a parsed file, for titles and labels; not validated. */
export function recordFromInput<F extends object>(spec: Pick<DomainSpec<F, object, object, unknown>, "fields">, input: ItemInput<F>, id = 0): ItemRecord<F> {
  const domain: Record<string, unknown> = {};
  const values = input as Record<string, unknown>;
  for (const field of spec.fields) domain[field.key] = values[field.key] ?? (field.type === "boolean" ? false : field.type === "list" ? [] : null);
  return {
    id,
    quantity: input.quantity ?? 1,
    purchasePrice: input.purchasePrice ?? null,
    notes: input.notes ?? null,
    location: input.location ?? null,
    photos: input.photos ?? [],
    referenceImageUrl: input.referenceImageUrl ?? null,
    accentColor: input.accentColor ?? null,
    externalIds: input.externalIds ?? {},
    identification: input.identification ?? null,
    manualValue: input.manualValue ?? null,
    manualPrices: input.manualPrices ?? {},
    createdAt: "",
    updatedAt: "",
    ...(domain as F),
  };
}

/** A field's value as it should read in a table cell. */
export function displayValue(spec: Pick<DomainSpec, "fields">, key: string, value: unknown): string {
  return optionLabel(spec.fields.find((f) => f.key === key), value);
}
