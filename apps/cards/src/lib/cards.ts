import { getDb } from "./db";
import type {
  CardInput,
  CardRecord,
  Condition,
  Game,
  Identification,
  PriceSnapshot,
  PriceSummary,
  Settings,
} from "./types";
import { CONDITIONS, GAMES, GRADING_STATUSES, MAX_MONEY, MAX_QUANTITY, type Centering, type GradingReport, type GradingStatus } from "./types";
import { readCentering, readGradingReport } from "./grading/schema";
import { addLot, costBasisByCard, deleteLot, getLot, listLots, reconcileToQuantity, recomputePurchasePrice, type AcquisitionInput } from "./acquisitions";
import { isValidUploadName } from "./images";
import { mirrorCard, unmirrorCard } from "./markdown/mirror";
import { normalizeNumber } from "./pricing/match";
import { summarize } from "./pricing";
import { getSettings } from "./settings";
import { alertsForRefresh, createAlert, deliver } from "./alerts";

export interface CardRow {
  id: number;
  game: string;
  sport: string | null;
  name: string;
  set_name: string | null;
  set_code: string | null;
  card_number: string | null;
  year: number | null;
  rarity: string | null;
  variant: string | null;
  language: string | null;
  manufacturer: string | null;
  quantity: number;
  condition: string;
  grading_company: string | null;
  grade: string | null;
  cert_number: string | null;
  centering: string | null;
  grading_report: string | null;
  purchase_price: number | null;
  notes: string | null;
  image_path: string | null;
  reference_image_url: string | null;
  accent_color: string | null;
  location: string | null;
  external_ids: string;
  identification: string | null;
  manual_ungraded: number | null;
  manual_graded: string;
  grading_status: string;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * A stored column read through the same checks its input went through. A row
 * written by a newer version, or edited by hand into a shape this version does
 * not know, reads as nothing rather than failing every list that touches it.
 */
function readStored<T>(text: string | null, read: (value: unknown) => T | null): T | null {
  const parsed = parseJson<unknown>(text, null);
  if (parsed === null) return null;
  try {
    return read(parsed);
  } catch {
    return null;
  }
}

export function rowToCard(row: CardRow): CardRecord {
  return {
    id: row.id,
    game: row.game as Game,
    sport: row.sport,
    name: row.name,
    setName: row.set_name,
    setCode: row.set_code,
    cardNumber: row.card_number,
    year: row.year,
    rarity: row.rarity,
    variant: row.variant,
    language: row.language,
    manufacturer: row.manufacturer,
    quantity: row.quantity,
    condition: row.condition as Condition,
    gradingCompany: row.grading_company,
    grade: row.grade,
    certNumber: row.cert_number,
    centering: readStored<Centering>(row.centering, readCentering),
    gradingReport: readStored<GradingReport>(row.grading_report, readGradingReport),
    purchasePrice: row.purchase_price,
    notes: row.notes,
    imagePath: row.image_path,
    referenceImageUrl: row.reference_image_url,
    accentColor: row.accent_color,
    location: row.location,
    externalIds: parseJson(row.external_ids, {}),
    identification: parseJson<Identification | null>(row.identification, null),
    manualUngraded: row.manual_ungraded,
    manualGraded: parseJson(row.manual_graded, {}),
    gradingStatus: (Object.hasOwn(GRADING_STATUSES, row.grading_status) ? row.grading_status : "undecided") as GradingStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};
/** Only http(s) URLs may be stored for rendering as links/images. */
const httpUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};
/** Only a #rrggbb literal may be stored, since it goes straight into a style attribute. */
const hexColor = (v: unknown): string | null => {
  const s = str(v);
  return s && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
};
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/**
 * A price someone typed or a column supplied. Blank is "not known", which is a
 * real answer; a negative or an absurd figure is a mistake, and refusing it
 * here is what keeps it out of every total downstream.
 */
export const price = (v: unknown, what: string): number | null => {
  const n = num(v);
  if (n === null) return null;
  if (n < 0) throw new Error(`${what} cannot be negative`);
  if (n > MAX_MONEY) throw new Error(`${what} is larger than anything this app will record`);
  return n;
};

/** Validate and normalize client input; throws on missing required fields. */
export function normalizeInput(input: CardInput): Required<
  Omit<CardInput, "identification" | "centering" | "gradingReport">
> & { identification: Identification | null; centering: Centering | null; gradingReport: GradingReport | null } {
  const game = str(input.game) as Game | null;
  // Object.hasOwn, not `in`: "constructor" and "toString" are on every object's
  // prototype, and would otherwise pass as a game, a condition or a status.
  if (!game || !Object.hasOwn(GAMES, game)) throw new Error(`Unknown game: ${input.game}`);
  const name = str(input.name);
  if (!name) throw new Error("Card name is required");
  const condition = (str(input.condition) ?? "NM") as Condition;
  if (!Object.hasOwn(CONDITIONS, condition)) throw new Error(`Unknown condition: ${condition}`);
  const quantity = Math.max(0, Math.floor(num(input.quantity) ?? 1));
  if (quantity > MAX_QUANTITY) throw new Error(`A quantity of ${quantity} is larger than anything this app will record`);
  const gradingStatus = (str(input.gradingStatus) ?? "undecided") as GradingStatus;
  if (!Object.hasOwn(GRADING_STATUSES, gradingStatus)) throw new Error(`Unknown grading status: ${gradingStatus}`);
  const gradedNums: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.manualGraded ?? {})) {
    const n = price(v, `The manual price for ${k.trim() || "a grade"}`);
    if (n !== null && k.trim()) gradedNums[k.trim()] = n;
  }
  return {
    game,
    name,
    sport: str(input.sport),
    setName: str(input.setName),
    setCode: str(input.setCode),
    cardNumber: str(input.cardNumber),
    year: num(input.year) === null ? null : Math.floor(num(input.year)!),
    rarity: str(input.rarity),
    variant: str(input.variant),
    language: str(input.language),
    manufacturer: str(input.manufacturer),
    quantity,
    condition,
    gradingCompany: str(input.gradingCompany),
    grade: str(input.grade),
    certNumber: str(input.certNumber),
    // Both readers throw with a reason, as a bad quantity does, so a malformed
    // ratio or report is refused at the door rather than stored and shown.
    centering: readCentering(input.centering),
    gradingReport: readGradingReport(input.gradingReport),
    purchasePrice: price(input.purchasePrice, "The purchase price"),
    notes: str(input.notes),
    imagePath: str(input.imagePath) && isValidUploadName(str(input.imagePath)!) ? str(input.imagePath) : null,
    referenceImageUrl: httpUrl(input.referenceImageUrl),
    accentColor: hexColor(input.accentColor),
    location: str(input.location)?.slice(0, 120) ?? null,
    externalIds: Object.fromEntries(
      Object.entries(input.externalIds ?? {}).filter(([, v]) => str(v)),
    ) as Record<string, string>,
    identification: input.identification ?? null,
    manualUngraded: price(input.manualUngraded, "The manual price"),
    manualGraded: gradedNums,
    gradingStatus,
  };
}

/**
 * Cards written inside a transaction are mirrored once it commits: a rolled
 * back intake must not leave a Markdown file for a card that does not exist.
 */
/** Card id -> whether it might already be filed under a different name. */
const globalForMirror = globalThis as unknown as { __collectcollectDeferredMirror?: Map<number, boolean> };
// On the global object, like the connection: a development reload in the
// middle of a transaction must not lose the list of what to mirror after it.
const deferredMirror: Map<number, boolean> = (globalForMirror.__collectcollectDeferredMirror ??= new Map());

function touch(card: CardRecord | null, opts: { mayHaveOldName?: boolean } = {}): void {
  if (!card) return;
  const mayHaveOldName = opts.mayHaveOldName !== false;
  if (getDb().inTransaction) {
    // Keep the hint: importing a thousand new cards must not make a thousand
    // passes over the folder looking for files that cannot exist.
    deferredMirror.set(card.id, (deferredMirror.get(card.id) ?? false) || mayHaveOldName);
  } else {
    mirrorCard(card, opts);
  }
}

/**
 * Write the Markdown files for everything a transaction touched. Callers that
 * open their own transaction must call this after it commits, and
 * `discardDeferredMirror` if it rolls back.
 */
export function flushDeferredMirror(): void {
  for (const [id, mayHaveOldName] of deferredMirror) {
    const card = getCard(id);
    if (card) mirrorCard(card, { mayHaveOldName });
  }
  deferredMirror.clear();
}

/** Rewrite a card's Markdown file after something outside this module changed it. */
export function refreshMirror(cardId: number): void {
  touch(getCard(cardId));
}

export function discardDeferredMirror(): void {
  deferredMirror.clear();
}

export function createCard(input: CardInput): CardRecord {
  const c = normalizeInput(input);
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO cards (game, sport, name, set_name, set_code, card_number, year, rarity, variant,
        language, manufacturer, quantity, condition, grading_company, grade, cert_number, centering, grading_report, purchase_price,
        notes, image_path, reference_image_url, accent_color, location, external_ids, identification, manual_ungraded, manual_graded,
        grading_status, created_at, updated_at)
       VALUES (@game, @sport, @name, @setName, @setCode, @cardNumber, @year, @rarity, @variant,
        @language, @manufacturer, @quantity, @condition, @gradingCompany, @grade, @certNumber, @centering, @gradingReport, @purchasePrice,
        @notes, @imagePath, @referenceImageUrl, @accentColor, @location, @externalIds, @identification, @manualUngraded, @manualGraded,
        @gradingStatus, @now, @now)`,
    )
    .run({
      ...c,
      centering: c.centering ? JSON.stringify(c.centering) : null,
      gradingReport: c.gradingReport ? JSON.stringify(c.gradingReport) : null,
      externalIds: JSON.stringify(c.externalIds),
      identification: c.identification ? JSON.stringify(c.identification) : null,
      manualGraded: JSON.stringify(c.manualGraded),
      now,
    });
  const created = getCard(Number(result.lastInsertRowid))!;
  // Every copy has to belong to a lot, or the cost basis and the quantity stop
  // agreeing. A card added without a price gets a lot with an unknown cost.
  if (created.quantity > 0) {
    addLot(created.id, { quantity: created.quantity, unitCost: created.purchasePrice, acquiredAt: created.createdAt });
  }
  const card = getCard(created.id)!;
  touch(card, { mayHaveOldName: false });
  return card;
}

export function updateCard(id: number, patch: Partial<CardInput>): CardRecord | null {
  // One transaction: the row, its lots and the price derived from them change
  // together or not at all. A failure between the row and the lots would leave
  // a quantity the ledger does not account for.
  const run = getDb().transaction((): CardRecord | null => {
    const existing = getCard(id);
    if (!existing) return null;
    const merged = normalizeInput({ ...existing, ...patch, game: patch.game ?? existing.game, name: patch.name ?? existing.name });
    // A card whose identity changed is no longer the product the sources were
    // matched to. Forget the learned ids and the reference image, unless the
    // edit set them itself, so the next refresh searches afresh instead of
    // asking for the old product by id — which is how a wrong match used to
    // outlive every correction.
    if (identityChanged(existing, merged)) {
      if (patch.externalIds === undefined) merged.externalIds = {};
      if (patch.referenceImageUrl === undefined) merged.referenceImageUrl = null;
    }
    getDb()
      .prepare(
        `UPDATE cards SET game=@game, sport=@sport, name=@name, set_name=@setName, set_code=@setCode,
          card_number=@cardNumber, year=@year, rarity=@rarity, variant=@variant, language=@language,
          manufacturer=@manufacturer, quantity=@quantity, condition=@condition, grading_company=@gradingCompany,
          grade=@grade, cert_number=@certNumber, centering=@centering, grading_report=@gradingReport, purchase_price=@purchasePrice, notes=@notes, image_path=@imagePath,
          reference_image_url=@referenceImageUrl, accent_color=@accentColor, location=@location, external_ids=@externalIds, identification=@identification,
          manual_ungraded=@manualUngraded, manual_graded=@manualGraded, grading_status=@gradingStatus, updated_at=@now
         WHERE id=@id`,
      )
      .run({
        ...merged,
        id,
        centering: merged.centering ? JSON.stringify(merged.centering) : null,
        gradingReport: merged.gradingReport ? JSON.stringify(merged.gradingReport) : null,
        externalIds: JSON.stringify(merged.externalIds),
        identification: merged.identification ? JSON.stringify(merged.identification) : null,
        manualGraded: JSON.stringify(merged.manualGraded),
        now: new Date().toISOString(),
      });
    if (merged.quantity !== existing.quantity) reconcileToQuantity(id, merged.quantity);
    if (patch.purchasePrice !== undefined && merged.purchasePrice !== existing.purchasePrice) {
      // With one lot the purchase price is still something the owner sets
      // directly. With several it is an average of them, so the edit is ignored
      // and the recompute below puts the average back.
      const lots = listLots(id);
      const only = lots.length === 1 ? lots[0] : undefined;
      if (lots.length > 1) throw new Error("Edit the individual purchases to change their costs.");
      if (only && (only.remaining !== only.quantity || getDb().prepare("SELECT 1 FROM sale_lots WHERE acquisition_id=? LIMIT 1").get(only.id))) {
        throw new Error("Copies from this purchase have been sold. Undo those sales before changing its cost.");
      }
      if (only) {
        getDb().prepare("UPDATE acquisitions SET unit_cost = ? WHERE id = ?").run(merged.purchasePrice, only.id);
      }
    }
    recomputePurchasePrice(id);
    // The grade, the condition and the owner's own prices decide what the
    // copy is worth; the latest snapshot keeps the quotes to work that out
    // from, so the value moves now rather than at the next refresh.
    const revalued = (fields: readonly (typeof REVALUING_FIELDS)[number][]) =>
      fields.some((f) => patch[f] !== undefined && canonical(existing[f]) !== canonical(merged[f]));
    if (revalued(REVALUING_FIELDS)) {
      const settings = getSettings();
      const before = latestSnapshot(id);
      const result = recomputeLatestSnapshot(id, settings);
      // The owner's own price is the recorded price, so a change past the
      // alert threshold is a move worth mentioning, and it is mentioned now
      // rather than at the next refresh, which would no longer see it. A grade
      // or a condition is a reclassification, not a move, and says nothing.
      if (result?.changed && before && revalued(MANUAL_PRICE_FIELDS)) {
        const card = getCard(id);
        if (card) {
          for (const alert of alertsForRefresh(card, before.summary, result.snapshot.summary, [], settings, "when you changed its price")) {
            if (alert.kind === "price_move") void deliver(createAlert(alert), settings);
          }
        }
      }
    }
    return getCard(id);
  });
  const card = run();
  touch(card);
  return card;
}

/** The fields that say which product a card is, as the price sources are asked about it. */
const IDENTITY_FIELDS = ["game", "name", "sport", "setName", "setCode", "cardNumber", "year", "variant", "manufacturer", "language"] as const;

/** The fields that change what the owner's copy is worth without a new lookup. */
const REVALUING_FIELDS = ["grade", "gradingCompany", "condition", "manualUngraded", "manualGraded"] as const;
/** The two of those that are prices, whose movement is an alert's business. */
const MANUAL_PRICE_FIELDS = ["manualUngraded", "manualGraded"] as const;

/** JSON with keys in a fixed order, so two objects that mean the same compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v ?? null,
  );
}

function identityChanged(before: CardRecord, after: ReturnType<typeof normalizeInput>): boolean {
  const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v ?? null);
  return IDENTITY_FIELDS.some((f) => norm(before[f]) !== norm(after[f]));
}

/**
 * Whether two copies can share one row. Grade and grading company, as before:
 * a raw scan must never be folded into a slab. The cert number too: two slabs
 * are two objects with two reports, and one row holds one cert. And variant,
 * language and condition, since each is valued differently — a 1st Edition,
 * a Japanese printing or a Damaged copy priced as the Unlimited, English,
 * Near Mint row it was folded into would be the wrong money. Case and
 * whitespace do not divide copies and a blank on both sides agrees, but a
 * blank on one side does not match a value on the other: a scan that could
 * not read the variant must not be folded into a holo row.
 */
export function interchangeable(
  a: Pick<CardRecord, "grade" | "gradingCompany" | "certNumber" | "variant" | "language" | "condition">,
  b: Pick<CardRecord, "grade" | "gradingCompany" | "certNumber" | "variant" | "language" | "condition">,
): boolean {
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  return (["grade", "gradingCompany", "certNumber", "variant", "language", "condition"] as const).every((f) => norm(a[f]) === norm(b[f]));
}

/**
 * Keep what a refresh learned about a card — provider ids, a reference image —
 * without counting it as an edit: no updated_at, so a whole-collection refresh
 * does not reorder the collection, and no Markdown of its own, since the
 * snapshot the refresh stores rewrites the file anyway. Existing ids win, so
 * a match already made is not swapped for another; forgetting one is an edit.
 */
export function rememberLearned(id: number, learned: { externalIds: Record<string, string>; referenceImageUrl: string | null }): boolean {
  const existing = getCard(id);
  if (!existing) return false;
  const externalIds = { ...learned.externalIds, ...existing.externalIds };
  const referenceImageUrl = existing.referenceImageUrl ?? learned.referenceImageUrl;
  if (canonical(externalIds) === canonical(existing.externalIds) && referenceImageUrl === existing.referenceImageUrl) return false;
  getDb().prepare("UPDATE cards SET external_ids = ?, reference_image_url = ? WHERE id = ?").run(JSON.stringify(externalIds), referenceImageUrl, id);
  return true;
}

/**
 * Re-derive the latest snapshot's summary from the quotes it stored, for the
 * card as it is now and the settings as they are now. summarize() is pure and
 * every snapshot keeps its quotes, so a grade, a condition, a manual price or
 * a multiplier changes the value at once rather than at the next refresh.
 *
 * The snapshot is rewritten in place: a new row would put a second point on
 * the same date in every history and store the quotes twice. The quotes and
 * fetchedAt are untouched — the prices are still the ones fetched then —
 * and recomputedAt says the derived figures moved later. Nothing here is a
 * price move, so no alert is raised.
 *
 * The same rule as a refresh: a result with no price at all is not written
 * over a snapshot that has one. A manual price taken away from a card no
 * source prices leaves the last known value standing, as a lookup that finds
 * nothing does, rather than zeroing the card out of the portfolio.
 */
export function recomputeLatestSnapshot(cardId: number, settings: Settings): { snapshot: PriceSnapshot; changed: boolean } | null {
  const card = getCard(cardId);
  const latest = latestSnapshot(cardId);
  if (!card || !latest) return null;
  // The manual quote is re-added by summarize from the card's own prices, so
  // the stored one is left out rather than counted twice.
  const quotes = latest.summary.quotes.filter((q) => q.source !== "manual");
  const next = summarize(
    quotes,
    latest.summary.errors,
    settings,
    { condition: card.condition, gradingCompany: card.gradingCompany, grade: card.grade },
    { ungraded: card.manualUngraded, graded: card.manualGraded },
    latest.fetchedAt,
  );
  const { recomputedAt: _before, ...was } = latest.summary;
  void _before;
  if (canonical(was) === canonical(next)) return { snapshot: latest, changed: false };
  if (!hasAnyPrice(next) && hasAnyPrice(was)) return { snapshot: latest, changed: false };
  const summary: PriceSummary = { ...next, recomputedAt: new Date().toISOString() };
  getDb().prepare("UPDATE price_snapshots SET summary = ? WHERE id = ?").run(JSON.stringify(summary), latest.id);
  return { snapshot: { ...latest, summary }, changed: true };
}

/** Whether a summary prices the card at all, the way a refresh judges its own answer. */
function hasAnyPrice(s: PriceSummary): boolean {
  return Boolean(s.ungraded || s.yourCopyValue || Object.keys(s.graded).length);
}

/**
 * Re-derive every card's latest value after the settings changed. One
 * transaction, one Markdown write per card that actually moved; a card whose
 * figures come out the same is left alone.
 */
export function recomputeAllLatest(settings: Settings): number {
  const ids = [...latestSnapshotsByCard().keys()];
  let changed = 0;
  const run = getDb().transaction(() => {
    for (const id of ids) {
      if (recomputeLatestSnapshot(id, settings)?.changed) {
        changed++;
        touch(getCard(id), { mayHaveOldName: false });
      }
    }
  });
  try {
    run();
    flushDeferredMirror();
  } catch (e) {
    discardDeferredMirror();
    throw e;
  }
  return changed;
}

/** Thrown when a card that has sales on record is asked to go. */
export class HasSalesError extends Error {
  constructor(public readonly sales: number) {
    super(
      `This card has ${sales} recorded sale${sales === 1 ? "" : "s"}. Undo ${sales === 1 ? "it" : "them"} first, or keep the card: one that has sold out stays with its history.`,
    );
    this.name = "HasSalesError";
  }
}

/** Record another purchase of a card already held. */
export function addAcquisition(cardId: number, input: AcquisitionInput): CardRecord | null {
  const run = getDb().transaction(() => {
    const card = getCard(cardId);
    if (!card) return null;
    const lot = addLot(cardId, input);
    getDb().prepare("UPDATE cards SET quantity = quantity + ?, updated_at = ? WHERE id = ?").run(lot.quantity, new Date().toISOString(), cardId);
    recomputePurchasePrice(cardId);
    return getCard(cardId);
  });
  const updated = run();
  touch(updated);
  return updated;
}

/** Undo a purchase that was recorded by mistake. */
export function removeAcquisition(lotId: number): CardRecord | null {
  const run = getDb().transaction(() => {
    const lot = getLot(lotId);
    if (!lot) return null;
    const card = getCard(lot.cardId);
    if (!card) return null;
    deleteLot(lotId);
    getDb()
      .prepare("UPDATE cards SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?")
      .run(lot.remaining, new Date().toISOString(), lot.cardId);
    recomputePurchasePrice(lot.cardId);
    return getCard(lot.cardId);
  });
  const updated = run();
  touch(updated);
  return updated;
}

function normalizeSet(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Two set names for the same set. One being written more fully than the other
 * is fine ("Base" for "Base Set"), but what the longer one adds must not be a
 * number: "Base Set" and "Base Set 2" are different sets, and merging a card
 * from one into the other would quietly lose a card.
 */
function sameSet(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  const extra = longer.startsWith(shorter)
    ? longer.slice(shorter.length)
    : longer.endsWith(shorter)
      ? longer.slice(0, longer.length - shorter.length)
      : null;
  return extra !== null && !/\d/.test(extra);
}

/**
 * Cards that look like the same card (same game and name, and a matching
 * number or set when either side has one). Used to catch accidental
 * duplicates when adding.
 */
export function findSimilar(input: { game: Game; name: string; cardNumber?: string | null; setName?: string | null }): CardRecord[] {
  const name = input.name.trim().toLowerCase();
  if (!name) return [];
  const rows = getDb()
    // Timestamps are only millisecond-resolution, so two cards saved in the
    // same tick would otherwise come back in whatever order SQLite fancied.
    .prepare("SELECT * FROM cards WHERE game = ? AND lower(trim(name)) = ? ORDER BY updated_at DESC, id DESC")
    .all(input.game, name) as CardRow[];
  const num = normalizeNumber(input.cardNumber);
  const set = normalizeSet(input.setName);
  return rows.map(rowToCard).filter((c) => {
    const cnum = normalizeNumber(c.cardNumber);
    const cset = normalizeSet(c.setName);
    if (num && cnum) return num === cnum;
    if (set && cset) return sameSet(set, cset);
    return true; // neither side has distinguishing detail: same name is the best we can do
  });
}

export type IntakeOutcome =
  | { result: "created"; card: CardRecord }
  | { result: "merged"; card: CardRecord }
  | { result: "ambiguous"; candidates: CardRecord[] };

/**
 * Add a scanned card in one transaction: merge into an existing row when there
 * is exactly one unambiguous match, otherwise create. Doing this on the server
 * keeps concurrent scans of the same card from both reading the old quantity
 * and each adding one copy.
 *
 * A match only counts when the copies are interchangeable: both ungraded, or
 * graded by the same company to the same grade. A raw scan must never be
 * folded into a slab, since it would then be valued as a graded copy.
 */
export function intakeCard(input: CardInput): IntakeOutcome {
  try {
    const outcome = intakeCardWithin(input);
    flushDeferredMirror();
    return outcome;
  } catch (e) {
    discardDeferredMirror();
    throw e;
  }
}

/**
 * The intake itself, for a caller that has opened its own transaction — a
 * spreadsheet import takes every row inside one, so a file that fails half way
 * leaves nothing behind. Each row is still its own savepoint, so one bad row
 * rolls back alone and the rest go in. The caller flushes the mirror once the
 * outer transaction commits, or discards it if that rolls back.
 */
export function intakeCardWithin(input: CardInput): IntakeOutcome {
  const clean = normalizeInput(input);
  const run = getDb().transaction((): IntakeOutcome => {
    const candidates = findSimilar({
      game: clean.game,
      name: clean.name,
      cardNumber: clean.cardNumber,
      setName: clean.setName,
    });
    const alike = candidates.filter((c) => interchangeable(c, clean));
    if (candidates.length > 0 && alike.length !== 1) {
      return { result: "ambiguous", candidates };
    }
    const existing = alike.length === 1 ? alike[0] : undefined;
    if (existing) {
      const copies = clean.quantity || 1;
      // The copies being merged in are their own purchase at their own price;
      // folding them into the existing row's price would lose what they cost.
      addLot(existing.id, { quantity: copies, unitCost: clean.purchasePrice });
      const patch: Partial<CardInput> = { quantity: existing.quantity + copies };
      if (!existing.imagePath && clean.imagePath) {
        patch.imagePath = clean.imagePath;
        patch.accentColor = clean.accentColor;
      }
      return { result: "merged", card: updateCard(existing.id, patch)! };
    }
    return { result: "created", card: createCard(input) };
  });
  return run();
}

export function getCard(id: number): CardRecord | null {
  const row = getDb().prepare("SELECT * FROM cards WHERE id = ?").get(id) as CardRow | undefined;
  return row ? rowToCard(row) : null;
}

/** How many sales are on record for a card. */
export function countSales(cardId: number): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM sales WHERE card_id = ?").get(cardId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Remove a card and everything recorded about it — except that a card with
 * sales on record is refused. The sales table cascades from the card, so
 * deleting it would erase money that changed hands, which the report and the
 * tax year both still need. Throws `HasSalesError` in that case.
 */
export function deleteCard(id: number): boolean {
  const sales = countSales(id);
  if (sales > 0) throw new HasSalesError(sales);
  const gone = getDb().prepare("DELETE FROM cards WHERE id = ?").run(id).changes > 0;
  if (gone) unmirrorCard(id);
  return gone;
}

export type CardSort = "updated" | "name" | "value" | "added";
export const CARD_SORTS: readonly CardSort[] = ["updated", "name", "value", "added"];
export function isCardSort(value: unknown): value is CardSort {
  return typeof value === "string" && (CARD_SORTS as readonly string[]).includes(value);
}

export interface ListOptions {
  game?: Game;
  search?: string;
  location?: string;
  /** Only cards holding copies whose cost was never recorded. */
  missingCost?: boolean;
  /** The order; the default is by when each card was last touched. */
  sort?: CardSort;
  /** One page of the list, for a collection too large to send whole. */
  limit?: number;
  offset?: number;
}

/** The value the tile shows, read from a card's latest snapshot by the database. */
const LATEST_VALUE = `(SELECT json_extract(p.summary, '$.yourCopyValue') FROM price_snapshots p WHERE p.card_id = cards.id ORDER BY p.fetched_at DESC, p.id DESC LIMIT 1)`;

const ORDER: Record<CardSort, string> = {
  updated: "updated_at DESC, id DESC",
  name: "lower(trim(name)) ASC, id ASC",
  value: `${LATEST_VALUE} DESC NULLS LAST, updated_at DESC, id DESC`,
  added: "created_at DESC, id DESC",
};

function whereFor(opts: ListOptions): { where: string; params: Record<string, unknown> } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.game) {
    where.push("game = @game");
    params.game = opts.game;
  }
  if (opts.search?.trim()) {
    // % and _ are LIKE wildcards; someone searching for "50%" or "Ex_2" means
    // those characters, not "match anything".
    const clauses = ["name", "set_name", "card_number", "notes", "sport", "location"].map((c) => `${c} LIKE @q ESCAPE '\\'`);
    where.push(`(${clauses.join(" OR ")})`);
    params.q = `%${opts.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
  }
  if (opts.location !== undefined) {
    if (opts.location === "") where.push("(location IS NULL OR trim(location) = '')");
    else {
      where.push("location = @location");
      params.location = opts.location;
    }
  }
  // The same reading costBasisByCard gives: a copy still held from a lot with no cost.
  if (opts.missingCost) where.push("EXISTS (SELECT 1 FROM acquisitions a WHERE a.card_id = cards.id AND a.remaining > 0 AND a.unit_cost IS NULL)");
  return { where: where.length ? "WHERE " + where.join(" AND ") : "", params };
}

export function listCards(opts: ListOptions = {}): CardRecord[] {
  const { where, params } = whereFor(opts);
  const page = opts.limit === undefined ? "" : " LIMIT @limit OFFSET @offset";
  if (opts.limit !== undefined) {
    params.limit = Math.max(0, Math.floor(opts.limit));
    params.offset = Math.max(0, Math.floor(opts.offset ?? 0));
  }
  const sql = `SELECT * FROM cards ${where} ORDER BY ${ORDER[opts.sort ?? "updated"]}${page}`;
  return (getDb().prepare(sql).all(params) as CardRow[]).map(rowToCard);
}

/** How many cards a filter matches, whatever page of them is shown. */
export function countCards(opts: ListOptions = {}): number {
  const { where, params } = whereFor(opts);
  return (getDb().prepare(`SELECT count(*) AS n FROM cards ${where}`).get(params) as { n: number }).n;
}

/** The figures at the top of the collection page, over every card the filter matches. */
export interface CollectionTotals {
  cards: number;
  /** Cards with copies left; the rest were sold. */
  owned: number;
  copies: number;
  /** What the copies are worth at each card's latest value, and if every copy were raw. */
  value: number;
  ungraded: number;
  /** Owned cards whose latest snapshot values them. */
  priced: number;
}

export function collectionTotals(opts: ListOptions = {}): CollectionTotals {
  const { where, params } = whereFor(opts);
  const row = getDb()
    .prepare(
      `SELECT count(*) AS cards,
        coalesce(sum(CASE WHEN quantity > 0 THEN 1 ELSE 0 END), 0) AS owned,
        coalesce(sum(quantity), 0) AS copies,
        coalesce(sum(quantity * coalesce(v.value, 0)), 0) AS value,
        coalesce(sum(quantity * coalesce(v.ungraded, 0)), 0) AS ungraded,
        coalesce(sum(CASE WHEN quantity > 0 AND v.value > 0 THEN 1 ELSE 0 END), 0) AS priced
       FROM cards LEFT JOIN (
         SELECT p.card_id, json_extract(p.summary, '$.yourCopyValue') AS value, json_extract(p.summary, '$.ungraded') AS ungraded
         FROM price_snapshots p
         WHERE p.id = (SELECT q.id FROM price_snapshots q WHERE q.card_id = p.card_id ORDER BY q.fetched_at DESC, q.id DESC LIMIT 1)
       ) v ON v.card_id = cards.id ${where}`,
    )
    .get(params) as CollectionTotals;
  return { ...row, value: Math.round(row.value * 100) / 100, ungraded: Math.round(row.ungraded * 100) / 100 };
}

/** The two figures a collection tile shows, for these cards, from each one's latest snapshot. */
export function latestValuesByCard(ids: number[]): Map<number, Pick<PriceSummary, "yourCopyValue" | "ungraded">> {
  const map = new Map<number, Pick<PriceSummary, "yourCopyValue" | "ungraded">>();
  if (ids.length === 0) return map;
  const rows = getDb()
    .prepare(
      `SELECT c.id AS card_id, json_extract(s.summary, '$.yourCopyValue') AS your_copy_value, json_extract(s.summary, '$.ungraded') AS ungraded
       FROM cards c JOIN price_snapshots s ON s.id = (
         SELECT p.id FROM price_snapshots p WHERE p.card_id = c.id ORDER BY p.fetched_at DESC, p.id DESC LIMIT 1
       ) WHERE c.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as Array<{ card_id: number; your_copy_value: number | null; ungraded: number | null }>;
  for (const r of rows) map.set(r.card_id, { yourCopyValue: r.your_copy_value, ungraded: r.ungraded });
  return map;
}

/** Every location in use, with how many cards are kept there. */
export function listLocations(): Array<{ location: string; cards: number }> {
  return getDb()
    .prepare(
      `SELECT location, COUNT(*) AS cards FROM cards
       WHERE location IS NOT NULL AND trim(location) != '' AND quantity > 0
       GROUP BY location ORDER BY location COLLATE NOCASE`,
    )
    .all() as Array<{ location: string; cards: number }>;
}

export function addSnapshot(cardId: number, summary: PriceSummary): PriceSnapshot {
  const result = getDb()
    .prepare("INSERT INTO price_snapshots (card_id, fetched_at, summary) VALUES (?, ?, ?)")
    .run(cardId, summary.fetchedAt, JSON.stringify(summary));
  touch(getCard(cardId));
  return { id: Number(result.lastInsertRowid), cardId, fetchedAt: summary.fetchedAt, summary };
}

interface SnapshotRow {
  id: number;
  card_id: number;
  fetched_at: string;
  summary: string;
  checked_at: string | null;
}

function rowToSnapshot(r: SnapshotRow): PriceSnapshot {
  return {
    id: r.id,
    cardId: r.card_id,
    fetchedAt: r.fetched_at,
    summary: JSON.parse(r.summary) as PriceSummary,
    ...(r.checked_at ? { checkedAt: r.checked_at } : {}),
  };
}

/**
 * A refresh found the same prices this snapshot already holds: note when,
 * rather than storing a copy. Only the marker changes, so the holdings history
 * (which listens to the summary) records nothing, and nothing is mirrored.
 */
export function markChecked(snapshotId: number, at: string): void {
  getDb().prepare("UPDATE price_snapshots SET checked_at = ? WHERE id = ?").run(at, snapshotId);
}

export function listSnapshots(cardId: number, limit = 50): PriceSnapshot[] {
  const rows = getDb()
    .prepare("SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY fetched_at DESC, id DESC LIMIT ?")
    .all(cardId, limit) as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

export function latestSnapshot(cardId: number): PriceSnapshot | null {
  return listSnapshots(cardId, 1)[0] ?? null;
}

/** Every snapshot, oldest first (for the portfolio history). */
export function allSnapshots(): PriceSnapshot[] {
  const rows = getDb()
    .prepare("SELECT * FROM price_snapshots ORDER BY fetched_at ASC, id ASC")
    .all() as SnapshotRow[];
  return rows.map(rowToSnapshot);
}

/** Latest snapshot for every card in one query (for the collection view). */
export { costBasisByCard };

export function latestSnapshotsByCard(): Map<number, PriceSnapshot> {
  const rows = getDb()
    .prepare(
      `SELECT s.* FROM cards c JOIN price_snapshots s ON s.id = (
        SELECT p.id FROM price_snapshots p WHERE p.card_id = c.id
        ORDER BY p.fetched_at DESC, p.id DESC LIMIT 1
      )`,
    )
    .all() as SnapshotRow[];
  const map = new Map<number, PriceSnapshot>();
  for (const r of rows) map.set(r.card_id, rowToSnapshot(r));
  return map;
}

/** The two figures the portfolio line sums, for one snapshot. */
export interface SnapshotValue {
  id: number;
  cardId: number;
  fetchedAt: string;
  checkedAt?: string;
  summary: Pick<PriceSummary, "yourCopyValue" | "ungraded">;
}

/**
 * Every snapshot's value figures, oldest first, read out of the JSON by the
 * database rather than by parsing each summary with its quotes: the dashboard
 * only ever sums two numbers per row.
 */
export function snapshotValues(): SnapshotValue[] {
  const rows = getDb()
    .prepare(
      `SELECT id, card_id, fetched_at, checked_at,
        json_extract(summary, '$.yourCopyValue') AS your_copy_value,
        json_extract(summary, '$.ungraded') AS ungraded
       FROM price_snapshots ORDER BY fetched_at ASC, id ASC`,
    )
    .all() as Array<{ id: number; card_id: number; fetched_at: string; checked_at: string | null; your_copy_value: number | null; ungraded: number | null }>;
  return rows.map((r) => ({
    id: r.id,
    cardId: r.card_id,
    fetchedAt: r.fetched_at,
    ...(r.checked_at ? { checkedAt: r.checked_at } : {}),
    summary: { yourCopyValue: r.your_copy_value, ungraded: r.ungraded },
  }));
}

/** The newest `perCard` snapshots of every card, oldest first within each card, for the grading outlook. */
export function recentSnapshotsByCard(perCard: number): Map<number, PriceSnapshot[]> {
  const rows = getDb()
    .prepare(
      `SELECT id, card_id, fetched_at, summary, checked_at FROM (
        SELECT *, row_number() OVER (PARTITION BY card_id ORDER BY fetched_at DESC, id DESC) AS rn FROM price_snapshots
      ) WHERE rn <= ? ORDER BY card_id, fetched_at ASC, id ASC`,
    )
    .all(perCard) as SnapshotRow[];
  const map = new Map<number, PriceSnapshot[]>();
  for (const r of rows) {
    const s = rowToSnapshot(r);
    const list = map.get(s.cardId);
    if (list) list.push(s);
    else map.set(s.cardId, [s]);
  }
  return map;
}
