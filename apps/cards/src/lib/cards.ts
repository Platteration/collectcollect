import { getDb } from "./db";
import type {
  CardInput,
  CardRecord,
  Condition,
  Game,
  Identification,
  PriceSnapshot,
  PriceSummary,
} from "./types";
import { CONDITIONS, GAMES, GRADING_STATUSES, type GradingStatus } from "./types";
import { addLot, costBasisByCard, deleteLot, getLot, listLots, reconcileToQuantity, recomputePurchasePrice, type AcquisitionInput } from "./acquisitions";
import { isValidUploadName } from "./images";
import { mirrorCard, unmirrorCard } from "./markdown/mirror";
import { normalizeNumber } from "./pricing/match";

interface CardRow {
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

function rowToCard(row: CardRow): CardRecord {
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

/** Validate and normalize client input; throws on missing required fields. */
export function normalizeInput(input: CardInput): Required<
  Omit<CardInput, "identification">
> & { identification: Identification | null } {
  const game = str(input.game) as Game | null;
  // Object.hasOwn, not `in`: "constructor" and "toString" are on every object's
  // prototype, and would otherwise pass as a game, a condition or a status.
  if (!game || !Object.hasOwn(GAMES, game)) throw new Error(`Unknown game: ${input.game}`);
  const name = str(input.name);
  if (!name) throw new Error("Card name is required");
  const condition = (str(input.condition) ?? "NM") as Condition;
  if (!Object.hasOwn(CONDITIONS, condition)) throw new Error(`Unknown condition: ${condition}`);
  const quantity = Math.max(0, Math.floor(num(input.quantity) ?? 1));
  const gradingStatus = (str(input.gradingStatus) ?? "undecided") as GradingStatus;
  if (!Object.hasOwn(GRADING_STATUSES, gradingStatus)) throw new Error(`Unknown grading status: ${gradingStatus}`);
  const gradedNums: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.manualGraded ?? {})) {
    const n = num(v);
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
    purchasePrice: num(input.purchasePrice),
    notes: str(input.notes),
    imagePath: str(input.imagePath) && isValidUploadName(str(input.imagePath)!) ? str(input.imagePath) : null,
    referenceImageUrl: httpUrl(input.referenceImageUrl),
    accentColor: hexColor(input.accentColor),
    location: str(input.location)?.slice(0, 120) ?? null,
    externalIds: Object.fromEntries(
      Object.entries(input.externalIds ?? {}).filter(([, v]) => str(v)),
    ) as Record<string, string>,
    identification: input.identification ?? null,
    manualUngraded: num(input.manualUngraded),
    manualGraded: gradedNums,
    gradingStatus,
  };
}

/**
 * Cards written inside a transaction are mirrored once it commits: a rolled
 * back intake must not leave a Markdown file for a card that does not exist.
 */
/** Card id -> whether it might already be filed under a different name. */
const deferredMirror = new Map<number, boolean>();

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
        language, manufacturer, quantity, condition, grading_company, grade, cert_number, purchase_price,
        notes, image_path, reference_image_url, accent_color, location, external_ids, identification, manual_ungraded, manual_graded,
        grading_status, created_at, updated_at)
       VALUES (@game, @sport, @name, @setName, @setCode, @cardNumber, @year, @rarity, @variant,
        @language, @manufacturer, @quantity, @condition, @gradingCompany, @grade, @certNumber, @purchasePrice,
        @notes, @imagePath, @referenceImageUrl, @accentColor, @location, @externalIds, @identification, @manualUngraded, @manualGraded,
        @gradingStatus, @now, @now)`,
    )
    .run({
      ...c,
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
  const existing = getCard(id);
  if (!existing) return null;
  const merged = normalizeInput({ ...existing, ...patch, game: patch.game ?? existing.game, name: patch.name ?? existing.name });
  getDb()
    .prepare(
      `UPDATE cards SET game=@game, sport=@sport, name=@name, set_name=@setName, set_code=@setCode,
        card_number=@cardNumber, year=@year, rarity=@rarity, variant=@variant, language=@language,
        manufacturer=@manufacturer, quantity=@quantity, condition=@condition, grading_company=@gradingCompany,
        grade=@grade, cert_number=@certNumber, purchase_price=@purchasePrice, notes=@notes, image_path=@imagePath,
        reference_image_url=@referenceImageUrl, accent_color=@accentColor, location=@location, external_ids=@externalIds, identification=@identification,
        manual_ungraded=@manualUngraded, manual_graded=@manualGraded, grading_status=@gradingStatus, updated_at=@now
       WHERE id=@id`,
    )
    .run({
      ...merged,
      id,
      externalIds: JSON.stringify(merged.externalIds),
      identification: merged.identification ? JSON.stringify(merged.identification) : null,
      manualGraded: JSON.stringify(merged.manualGraded),
      now: new Date().toISOString(),
    });
  if (merged.quantity !== existing.quantity) reconcileToQuantity(id, merged.quantity);
  if (patch.purchasePrice !== undefined) {
    // With one lot the purchase price is still something the owner sets
    // directly. With several it is an average of them, so the edit is ignored
    // and the recompute below puts the average back.
    const lots = listLots(id);
    const only = lots.length === 1 ? lots[0] : undefined;
    if (only) {
      getDb().prepare("UPDATE acquisitions SET unit_cost = ? WHERE id = ?").run(merged.purchasePrice, only.id);
    }
  }
  recomputePurchasePrice(id);
  const card = getCard(id);
  touch(card);
  return card;
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
  const clean = normalizeInput(input);
  const run = getDb().transaction((): IntakeOutcome => {
    const candidates = findSimilar({
      game: clean.game,
      name: clean.name,
      cardNumber: clean.cardNumber,
      setName: clean.setName,
    });
    const interchangeable = candidates.filter(
      (c) =>
        (c.grade ?? null) === (clean.grade ?? null) &&
        (c.gradingCompany ?? null) === (clean.gradingCompany ?? null),
    );
    if (candidates.length > 0 && interchangeable.length !== 1) {
      return { result: "ambiguous", candidates };
    }
    const existing = interchangeable.length === 1 ? interchangeable[0] : undefined;
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
  try {
    const outcome = run();
    flushDeferredMirror();
    return outcome;
  } catch (e) {
    discardDeferredMirror();
    throw e;
  }
}

export function getCard(id: number): CardRecord | null {
  const row = getDb().prepare("SELECT * FROM cards WHERE id = ?").get(id) as CardRow | undefined;
  return row ? rowToCard(row) : null;
}

export function deleteCard(id: number): boolean {
  const gone = getDb().prepare("DELETE FROM cards WHERE id = ?").run(id).changes > 0;
  if (gone) unmirrorCard(id);
  return gone;
}

export interface ListOptions {
  game?: Game;
  search?: string;
  location?: string;
}

export function listCards(opts: ListOptions = {}): CardRecord[] {
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
  const sql = `SELECT * FROM cards ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC, id DESC`;
  return (getDb().prepare(sql).all(params) as CardRow[]).map(rowToCard);
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
}

export function listSnapshots(cardId: number, limit = 50): PriceSnapshot[] {
  const rows = getDb()
    .prepare("SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY fetched_at DESC, id DESC LIMIT ?")
    .all(cardId, limit) as SnapshotRow[];
  return rows.map((r) => ({
    id: r.id,
    cardId: r.card_id,
    fetchedAt: r.fetched_at,
    summary: JSON.parse(r.summary) as PriceSummary,
  }));
}

export function latestSnapshot(cardId: number): PriceSnapshot | null {
  return listSnapshots(cardId, 1)[0] ?? null;
}

/** Every snapshot, oldest first (for the portfolio history). */
export function allSnapshots(): PriceSnapshot[] {
  const rows = getDb()
    .prepare("SELECT * FROM price_snapshots ORDER BY fetched_at ASC, id ASC")
    .all() as SnapshotRow[];
  return rows.map((r) => ({
    id: r.id,
    cardId: r.card_id,
    fetchedAt: r.fetched_at,
    summary: JSON.parse(r.summary) as PriceSummary,
  }));
}

/** Latest snapshot for every card in one query (for the collection view). */
export { costBasisByCard };

export function latestSnapshotsByCard(): Map<number, PriceSnapshot> {
  const rows = getDb()
    .prepare(
      `SELECT s.* FROM price_snapshots s
       JOIN (SELECT card_id, MAX(id) AS max_id FROM price_snapshots GROUP BY card_id) m
         ON m.max_id = s.id`,
    )
    .all() as SnapshotRow[];
  const map = new Map<number, PriceSnapshot>();
  for (const r of rows) {
    map.set(r.card_id, {
      id: r.id,
      cardId: r.card_id,
      fetchedAt: r.fetched_at,
      summary: JSON.parse(r.summary) as PriceSummary,
    });
  }
  return map;
}
