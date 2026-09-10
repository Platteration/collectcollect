import type { Acquisition } from "../acquisitions";
import type {
  CardInput,
  CardRecord,
  Condition,
  Game,
  GradingStatus,
  Identification,
  PriceSnapshot,
  PriceSummary,
  Sale,
} from "../types";
import { CONDITIONS, GAMES, GAME_IDS, GRADING_STATUSES, cleanSubgrades } from "../types";
import { IdentificationSchema } from "../identify/schema";
import { money, parseDocument, readFenced, readMoney, readSection, readTable, slug, table, writeFrontMatter } from "@collectcollect/core/markdown/format";

/** Everything about one card that the plain-text copy preserves. */
export interface CardBundle {
  card: CardRecord;
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

/** What reading one of those files back gives you. */
export interface ParsedCard {
  id: number | null;
  input: CardInput;
  createdAt: string | null;
  updatedAt: string | null;
  sales: Array<Omit<Sale, "id" | "cardId" | "createdAt"> & { lots: ParsedSaleLot[] }>;
  acquisitions: ParsedLot[];
  snapshots: Array<{ fetchedAt: string; summary: PriceSummary }>;
  warnings: string[];
}

/**
 * What a card file's identification block has to look like. It is the schema
 * the model answers to, with the condition assessment allowed to be absent:
 * cards identified before that existed have records without it, and dropping
 * their identification on the way back in would lose real data.
 */
const STORED_IDENTIFICATION = IdentificationSchema.extend({
  condition_assessment: IdentificationSchema.shape.condition_assessment.nullish(),
  // The sports fields arrived later; a file written before them is still an identification.
  team: IdentificationSchema.shape.team.nullish(),
  rookie: IdentificationSchema.shape.rookie.nullish(),
  parallel: IdentificationSchema.shape.parallel.nullish(),
  serial_number: IdentificationSchema.shape.serial_number.nullish(),
  autograph: IdentificationSchema.shape.autograph.nullish(),
  relic: IdentificationSchema.shape.relic.nullish(),
  grading: IdentificationSchema.shape.grading.extend({ subgrades: IdentificationSchema.shape.grading.shape.subgrades.nullish() }),
});

export interface ParsedSaleLot {
  quantity: number;
  unitCost: number | null;
  /** The day the lot was acquired, which is how it is matched back to one. */
  acquiredOn: string | null;
}

const VALUE_HEADERS = ["Date", "Your copy", "Ungraded", "Graded", "Basis"];
const ACQUISITION_HEADERS = ["Acquired", "Copies", "Left", "Cost each", "From", "Notes"];
// "Lots" is appended rather than slotted in beside "Cost each", which would read
// better: the parser reads sale columns by position, so a file written before
// this column existed has to keep parsing exactly as it did.
const SALE_HEADERS = ["Sold", "Copies", "Each", "Fees", "Cost each", "Venue", "Notes", "Lots"];

/** `0007-charizard-base-set.md` — sorts by acquisition order and still reads. */
export function cardFileName(card: Pick<CardRecord, "id" | "name" | "setName">): string {
  const stem = slug([card.name, card.setName].filter(Boolean).join(" "));
  return `${String(card.id).padStart(4, "0")}${stem ? `-${stem}` : ""}.md`;
}

/** The `0007-` prefix that identifies every file ever written for a card. */
export function cardFilePrefix(id: number): string {
  return `${String(id).padStart(4, "0")}-`;
}

export function idFromFileName(name: string): number | null {
  const match = /^(\d+)(?:-|\.md$)/.exec(name);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Fields that belong on one line. Front matter is JSON so it escapes itself,
 * but a name holding a newline would otherwise write a heading or a table row
 * straight into the body and be read back as one.
 */
function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function detail(card: CardRecord): string {
  return [
    GAMES[card.game] ?? card.game,
    card.sport,
    card.setName,
    card.cardNumber ? `#${card.cardNumber}` : null,
    card.year,
    card.rarity,
    card.variant,
    card.team,
    card.parallel,
    card.serialNumber,
    card.rookie ? "RC" : null,
    card.autograph ? "Auto" : null,
    card.relic ? "Relic" : null,
    card.language && card.language.toLowerCase() !== "english" ? card.language : null,
  ]
    .filter(Boolean)
    .map(oneLine)
    .join(" · ");
}

function condition(card: CardRecord): string {
  if (card.grade) {
    return oneLine(`${card.gradingCompany ?? "Graded"} ${card.grade}${card.certNumber ? ` (cert ${card.certNumber})` : ""}`);
  }
  return `Ungraded, ${CONDITIONS[card.condition] ?? card.condition}`;
}

/** `PSA 10 $5,000.00 · PSA 9 $1,400.00 (PriceCharting)` */
function gradedCell(graded: Record<string, number>, source: string | null): string {
  const parts = Object.entries(graded)
    .filter(([, v]) => Number.isFinite(v))
    .map(([k, v]) => `${k} ${money(v)}`);
  if (!parts.length) return "";
  return `${parts.join(" · ")}${source ? ` (${source})` : ""}`;
}

function moneyCell(value: number | null, source: string | null): string {
  if (value === null || value === undefined) return "";
  return `${money(value)}${source ? ` (${source})` : ""}`;
}

// Source labels carry their own brackets ("Scryfall (TCGplayer-derived USD)"),
// so the split has to run to the last bracket, not the first balanced pair.
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

const SOURCE_RE = /^(.*?)\s*\((.*)\)\s*$/;

function splitSource(text: string): { rest: string; source: string | null } {
  const match = SOURCE_RE.exec(text.trim());
  if (!match) return { rest: text.trim(), source: null };
  return { rest: match[1].trim(), source: match[2].trim() || null };
}

/** Turn `PSA 10 $5,000 · PSA 9 $1,400` back into a map. */
function parseGraded(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of text.split("·")) {
    const match = /^\s*(.+?)\s+([$-]?[\d,.]+)\s*$/.exec(part);
    if (!match) continue;
    const value = readMoney(match[2]);
    if (value === null) continue;
    out[match[1].trim()] = value;
  }
  return out;
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
 * One card as a Markdown document: front matter holding the facts, prose and
 * tables holding everything a person would want to read. Nothing here needs
 * the app to make sense of it.
 */
export function cardMarkdown(bundle: CardBundle, opts: { photoHref?: (name: string) => string } = {}): string {
  const { card, sales, snapshots, acquisitions, saleLots } = bundle;
  const latest = snapshots.length ? snapshots[0].summary : null;
  const photoHref = opts.photoHref ?? ((name: string) => `../uploads/${name}`);

  const front = writeFrontMatter({
    id: card.id,
    name: card.name,
    game: card.game,
    sport: card.sport,
    set_name: card.setName,
    set_code: card.setCode,
    card_number: card.cardNumber,
    year: card.year,
    rarity: card.rarity,
    variant: card.variant,
    language: card.language,
    manufacturer: card.manufacturer,
    team: card.team,
    rookie: card.rookie,
    parallel: card.parallel,
    serial_number: card.serialNumber,
    autograph: card.autograph,
    relic: card.relic,
    quantity: card.quantity,
    condition: card.condition,
    grading_company: card.gradingCompany,
    grade: card.grade,
    cert_number: card.certNumber,
    subgrades: card.subgrades,
    grading_status: card.gradingStatus,
    purchase_price: card.purchasePrice,
    location: card.location,
    photo: card.imagePath,
    reference_image_url: card.referenceImageUrl,
    accent_color: card.accentColor,
    external_ids: card.externalIds,
    manual_ungraded: card.manualUngraded,
    manual_graded: card.manualGraded,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
  });

  // Blocks are joined with exactly one blank line between them, rather than
  // squeezed afterwards: collapsing the finished document would also flatten
  // the blank lines inside somebody's notes.
  const blocks: string[] = [];
  blocks.push(`# ${oneLine(card.name)}`);
  blocks.push(detail(card));
  blocks.push(
    [
      `**${card.quantity}** cop${card.quantity === 1 ? "y" : "ies"}`,
      condition(card),
      card.location ? `kept in ${oneLine(card.location)}` : null,
      card.gradingStatus !== "undecided" ? GRADING_STATUSES[card.gradingStatus] : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const value = latest?.yourCopyValue ?? null;
  if (value !== null || card.purchasePrice !== null) {
    const bits: string[] = [];
    if (value !== null) {
      bits.push(`Last valued at **${money(value)}** per copy${card.quantity > 1 ? ` (${money(value * card.quantity)} in total)` : ""}.`);
      if (latest?.yourCopyBasis) bits.push(latest.yourCopyBasis);
      bits.push(`Priced ${snapshots[0].fetchedAt.slice(0, 10)}.`);
    }
    if (card.purchasePrice !== null) bits.push(`Paid ${money(card.purchasePrice)} per copy.`);
    blocks.push(bits.join(" "));
  }

  if (card.imagePath) {
    blocks.push("## Photo", `![${oneLine(card.name)}](${photoHref(card.imagePath)})`);
  } else if (card.referenceImageUrl) {
    blocks.push("## Photo", `Reference image: <${card.referenceImageUrl}>`);
  }

  if (card.notes?.trim()) {
    blocks.push("## Notes", escapeProse(card.notes.trim()));
  }

  if (snapshots.length) {
    blocks.push(
      "## Value history",
      table(
        VALUE_HEADERS,
        snapshots.map((s) => [
          s.fetchedAt,
          s.summary.yourCopyValue === null ? "" : money(s.summary.yourCopyValue),
          moneyCell(s.summary.ungraded, s.summary.ungradedSource),
          gradedCell(s.summary.graded ?? {}, s.summary.gradedSource),
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
          // known", which is a different thing from a card that was free.
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

  if (card.identification) {
    blocks.push(
      "## Identification",
      `Read from the photo by the app, confidence ${Math.round((card.identification.confidence ?? 0) * 100)}%.`,
      ["```json", JSON.stringify(card.identification, null, 2), "```"].join("\n"),
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

/**
 * Read one card file. Returns null only when the file is not a card at all;
 * anything else that is wrong costs a warning, never the card. The point of
 * these files is to survive, which means a mangled row loses that row.
 */
export function parseCardMarkdown(text: string): ParsedCard | null {
  const { data, body } = parseDocument(text);
  // Every card file carries front matter. Without it this is prose that
  // happens to have a title — the folder's own README, most likely — and
  // reading it as a card would invent one.
  if (Object.keys(data).length === 0) return null;
  const name = str(data.name) ?? str(/^#\s+(.*)$/m.exec(body)?.[1]);
  if (!name) return null;
  const warnings: string[] = [];

  const rawGame = (str(data.game) ?? "other").toLowerCase();
  const game = (GAME_IDS as string[]).includes(rawGame) ? (rawGame as Game) : "other";
  if (game !== rawGame) warnings.push(`Unknown game "${rawGame}", filed under Other`);

  const rawCondition = (str(data.condition) ?? "NM").toUpperCase();
  const conditionValue = (Object.hasOwn(CONDITIONS, rawCondition) ? rawCondition : "NM") as Condition;
  if (conditionValue !== rawCondition) warnings.push(`Unknown condition "${rawCondition}", read as NM`);

  const rawStatus = str(data.grading_status) ?? "undecided";
  const gradingStatus = (Object.hasOwn(GRADING_STATUSES, rawStatus) ? rawStatus : "undecided") as GradingStatus;

  const notesSection = readSection(body, "Notes");
  const identificationJson = readFenced(body, "Identification");
  let identification: Identification | null = null;
  if (identificationJson) {
    try {
      // Held to the same shape the model's own answers are held to. It is read
      // back out by pages that do arithmetic and string work on its fields, so
      // a block that merely looks like JSON is not good enough.
      const checked = STORED_IDENTIFICATION.safeParse(JSON.parse(identificationJson));
      if (checked.success) identification = checked.data as Identification;
      else warnings.push("The identification block did not describe a card and was dropped");
    } catch {
      warnings.push("The identification block was not readable JSON and was dropped");
    }
  }

  const quantity = num(data.quantity);
  const input: CardInput = {
    game,
    name,
    sport: str(data.sport),
    setName: str(data.set_name),
    setCode: str(data.set_code),
    cardNumber: str(data.card_number),
    year: num(data.year),
    rarity: str(data.rarity),
    variant: str(data.variant),
    language: str(data.language),
    manufacturer: str(data.manufacturer),
    team: str(data.team),
    rookie: data.rookie === true,
    parallel: str(data.parallel),
    serialNumber: str(data.serial_number),
    autograph: data.autograph === true,
    relic: data.relic === true,
    quantity: quantity === null ? 1 : Math.max(0, Math.round(quantity)),
    condition: conditionValue,
    gradingCompany: str(data.grading_company),
    grade: str(data.grade),
    certNumber: str(data.cert_number),
    subgrades: cleanSubgrades(data.subgrades),
    purchasePrice: num(data.purchase_price),
    notes: notesSection ? unescapeProse(notesSection) : null,
    imagePath: str(data.photo),
    referenceImageUrl: str(data.reference_image_url),
    accentColor: str(data.accent_color),
    location: str(data.location),
    externalIds: record(data.external_ids),
    identification,
    manualUngraded: num(data.manual_ungraded),
    manualGraded: numberRecord(data.manual_graded),
    gradingStatus,
  };

  const sales: ParsedCard["sales"] = [];
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
      // Absent in files written before sales said which copies they took.
      lots: parseLotsCell(row[7] ?? ""),
    });
  }

  const acquisitions: ParsedLot[] = [];
  const lotSection = readSection(body, "Acquisitions");
  for (const row of readTable(body, "Acquisitions")) {
    const [acquiredAt, copies, left, cost, source, lotNotes] = row;
    const quantity = num(copies);
    if (!acquiredAt || Number.isNaN(Date.parse(acquiredAt)) || quantity === null || quantity < 1) {
      warnings.push(`Skipped an unreadable purchase row: ${row.join(" | ")}`);
      continue;
    }
    const remaining = num(left);
    acquisitions.push({
      quantity: Math.round(quantity),
      remaining: remaining === null ? Math.round(quantity) : Math.max(0, Math.min(Math.round(quantity), Math.round(remaining))),
      unitCost: readMoney(cost ?? ""),
      acquiredAt,
      source: source || null,
      notes: lotNotes || null,
    });
  }
  if (lotSection === null && (input.quantity ?? 0) > 0) {
    // A file written before this app recorded purchases separately. It knows
    // how many copies there are and what they cost on average, which is exactly
    // one lot's worth of information — the same reading the database backfill
    // gives an older collection.
    acquisitions.push({
      quantity: input.quantity!,
      remaining: input.quantity!,
      unitCost: input.purchasePrice ?? null,
      acquiredAt: str(data.created_at) ?? str(data.updated_at) ?? new Date(0).toISOString(),
      source: null,
      notes: null,
    });
  }

  const snapshots: ParsedCard["snapshots"] = [];
  for (const row of readTable(body, "Value history")) {
    const [fetchedAt, yourCopy, ungradedCell, graded, basis] = row;
    if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) {
      warnings.push(`Skipped a price row with no readable date: ${row.join(" | ")}`);
      continue;
    }
    const ungraded = splitSource(ungradedCell ?? "");
    const gradedParts = splitSource(graded ?? "");
    snapshots.push({
      fetchedAt,
      summary: {
        currency: "USD",
        fetchedAt,
        ungraded: readMoney(ungraded.rest),
        ungradedSource: ungraded.source,
        graded: parseGraded(gradedParts.rest),
        gradedSource: gradedParts.source,
        estimatedGraded: {},
        yourCopyValue: readMoney(yourCopy ?? ""),
        yourCopyBasis: basis ?? "",
        quotes: [],
        errors: [],
      },
    });
  }

  const rawId = num(data.id);
  // SQLite hands rowids back through a double, so stay well inside what one
  // represents exactly; a 32-bit id is more than any collection needs.
  const id = rawId !== null && rawId >= 1 && rawId <= 2 ** 31 - 1 ? Math.round(rawId) : null;
  if (rawId !== null && id === null) warnings.push(`Ignored an id outside the usable range: ${rawId}`);

  return {
    id,
    input,
    createdAt: str(data.created_at),
    updatedAt: str(data.updated_at),
    sales,
    acquisitions,
    snapshots,
    warnings,
  };
}

export const INDEX_HEADERS = ["Card", "Game", "Set", "Number", "Copies", "Grade or condition", "Kept in", "Value"];
