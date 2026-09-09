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
import { CONDITIONS, GAMES, GAME_IDS, GRADING_STATUSES } from "../types";
import { money, parseDocument, readFenced, readMoney, readSection, readTable, slug, table, writeFrontMatter } from "./format";

/** Everything about one card that the plain-text copy preserves. */
export interface CardBundle {
  card: CardRecord;
  sales: Sale[];
  snapshots: PriceSnapshot[];
}

/** What reading one of those files back gives you. */
export interface ParsedCard {
  id: number | null;
  input: CardInput;
  createdAt: string | null;
  updatedAt: string | null;
  sales: Array<Omit<Sale, "id" | "cardId" | "createdAt">>;
  snapshots: Array<{ fetchedAt: string; summary: PriceSummary }>;
  warnings: string[];
}

const VALUE_HEADERS = ["Date", "Your copy", "Ungraded", "Graded", "Basis"];
const SALE_HEADERS = ["Sold", "Copies", "Each", "Fees", "Cost each", "Venue", "Notes"];

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

function detail(card: CardRecord): string {
  return [
    GAMES[card.game] ?? card.game,
    card.sport,
    card.setName,
    card.cardNumber ? `#${card.cardNumber}` : null,
    card.year,
    card.rarity,
    card.variant,
    card.language && card.language.toLowerCase() !== "english" ? card.language : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function condition(card: CardRecord): string {
  if (card.grade) return `${card.gradingCompany ?? "Graded"} ${card.grade}${card.certNumber ? ` (cert ${card.certNumber})` : ""}`;
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

const SOURCE_RE = /\(([^()]*)\)\s*$/;

function splitSource(text: string): { rest: string; source: string | null } {
  const match = SOURCE_RE.exec(text);
  if (!match) return { rest: text.trim(), source: null };
  return { rest: text.slice(0, match.index).trim(), source: match[1].trim() || null };
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
  return text.replace(/^(#{1,6}\s)/gm, "\\$1").replace(/^(---\s*)$/gm, "\\$1");
}

function unescapeProse(text: string): string {
  return text.replace(/^\\(#{1,6}\s)/gm, "$1").replace(/^\\(---\s*)$/gm, "$1");
}

/**
 * One card as a Markdown document: front matter holding the facts, prose and
 * tables holding everything a person would want to read. Nothing here needs
 * the app to make sense of it.
 */
export function cardMarkdown(bundle: CardBundle, opts: { photoHref?: (name: string) => string } = {}): string {
  const { card, sales, snapshots } = bundle;
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
    quantity: card.quantity,
    condition: card.condition,
    grading_company: card.gradingCompany,
    grade: card.grade,
    cert_number: card.certNumber,
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

  const lines: string[] = [front];
  lines.push(`# ${card.name}`, "");
  lines.push(detail(card), "");
  lines.push(
    [
      `**${card.quantity}** cop${card.quantity === 1 ? "y" : "ies"}`,
      condition(card),
      card.location ? `kept in ${card.location}` : null,
      card.gradingStatus !== "undecided" ? GRADING_STATUSES[card.gradingStatus] : null,
    ]
      .filter(Boolean)
      .join(" · "),
    "",
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
    lines.push(bits.join(" "), "");
  }

  if (card.imagePath) {
    lines.push("## Photo", "", `![${card.name}](${photoHref(card.imagePath)})`, "");
  } else if (card.referenceImageUrl) {
    lines.push("## Photo", "", `Reference image: <${card.referenceImageUrl}>`, "");
  }

  if (card.notes?.trim()) {
    lines.push("## Notes", "", escapeProse(card.notes.trim()), "");
  }

  if (snapshots.length) {
    lines.push("## Value history", "");
    lines.push(
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
      "",
    );
  }

  if (sales.length) {
    lines.push("## Sales", "");
    lines.push(
      table(
        SALE_HEADERS,
        sales.map((s) => [s.soldAt, s.quantity, money(s.unitPrice), money(s.fees), s.unitCost === null ? "" : money(s.unitCost), s.venue ?? "", s.notes ?? ""]),
      ),
      "",
    );
  }

  if (card.identification) {
    lines.push(
      "## Identification",
      "",
      `Read from the photo by the app, confidence ${Math.round((card.identification.confidence ?? 0) * 100)}%.`,
      "",
      "```json",
      JSON.stringify(card.identification, null, 2),
      "```",
      "",
    );
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
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
  const name = str(data.name) ?? str(/^#\s+(.*)$/m.exec(body)?.[1]);
  if (!name) return null;
  const warnings: string[] = [];

  const rawGame = (str(data.game) ?? "other").toLowerCase();
  const game = (GAME_IDS as string[]).includes(rawGame) ? (rawGame as Game) : "other";
  if (game !== rawGame) warnings.push(`Unknown game "${rawGame}", filed under Other`);

  const rawCondition = (str(data.condition) ?? "NM").toUpperCase();
  const conditionValue = (rawCondition in CONDITIONS ? rawCondition : "NM") as Condition;
  if (conditionValue !== rawCondition) warnings.push(`Unknown condition "${rawCondition}", read as NM`);

  const rawStatus = str(data.grading_status) ?? "undecided";
  const gradingStatus = (rawStatus in GRADING_STATUSES ? rawStatus : "undecided") as GradingStatus;

  const notesSection = readSection(body, "Notes");
  const identificationJson = readFenced(body, "Identification");
  let identification: Identification | null = null;
  if (identificationJson) {
    try {
      const parsed = JSON.parse(identificationJson) as Identification;
      // It is stored and shown as a record of what the model read; a number is
      // the only field anything computes with, so that is the one to insist on.
      identification = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...parsed, confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0 }
        : null;
      if (!identification) warnings.push("The identification block was not a record and was dropped");
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
    quantity: quantity === null ? 1 : Math.max(0, Math.round(quantity)),
    condition: conditionValue,
    gradingCompany: str(data.grading_company),
    grade: str(data.grade),
    certNumber: str(data.cert_number),
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
  const id = rawId !== null && rawId >= 1 && rawId <= Number.MAX_SAFE_INTEGER ? Math.round(rawId) : null;
  if (rawId !== null && id === null) warnings.push(`Ignored an id outside the usable range: ${rawId}`);

  return {
    id,
    input,
    createdAt: str(data.created_at),
    updatedAt: str(data.updated_at),
    sales,
    snapshots,
    warnings,
  };
}

export const INDEX_HEADERS = ["Card", "Game", "Set", "Number", "Copies", "Grade or condition", "Kept in", "Value"];
