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
import { CONDITIONS, GAMES, GRADING_STATUSES, has, type GradingStatus } from "./types";
import { httpUrl } from "./format";
import { IdentificationSchema } from "./identify/schema";
import { isValidUploadName } from "./images";
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

export function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * A snapshot row as a record, or null when its summary is not JSON.
 *
 * Nothing reading the database can assume the rows are ones this app wrote: a
 * restore installs someone else's file wholesale, and a bare `JSON.parse` here
 * throws out of a server component, which has no error boundary to catch it —
 * one unreadable row would take out the portfolio, the collection, the report
 * and the cards API together. An unreadable snapshot is dropped instead, which
 * loses one price reading and nothing else.
 */
function rowToSnapshot(r: SnapshotRow): PriceSnapshot | null {
  const summary = parseJson<PriceSummary | null>(r.summary, null);
  if (!summary || typeof summary !== "object") return null;
  return { id: r.id, cardId: r.card_id, fetchedAt: r.fetched_at, summary };
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
    gradingStatus: has(GRADING_STATUSES, row.grading_status) ? row.grading_status : "undecided",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};
/** Only a #rrggbb literal may be stored, since it goes straight into a style attribute. */
const hexColor = (v: unknown): string | null => {
  const s = str(v);
  return s && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
};
/**
 * The identification blob as it may be stored. Every field is optional and
 * unknown keys are dropped, so an identification written before a field existed
 * still round-trips, but a client cannot use this column to persist an
 * arbitrary document of arbitrary size — it is reachable from POST /api/cards,
 * /api/cards/intake and PATCH /api/cards/[id], and alertsForRefresh reads back
 * into it.
 */
const StoredIdentification = IdentificationSchema.partial().extend({
  condition_assessment: IdentificationSchema.shape.condition_assessment.nullish(),
});

const identification = (v: unknown): Identification | null => {
  if (!v || typeof v !== "object") return null;
  const parsed = StoredIdentification.safeParse(v);
  return parsed.success ? (parsed.data as Identification) : null;
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
  if (!has(GAMES, game)) throw new Error(`Unknown game: ${input.game}`);
  const name = str(input.name);
  if (!name) throw new Error("Card name is required");
  const condition = (str(input.condition) ?? "NM") as Condition;
  if (!has(CONDITIONS, condition)) throw new Error(`Unknown condition: ${condition}`);
  const quantity = Math.max(0, Math.floor(num(input.quantity) ?? 1));
  const gradingStatus = (str(input.gradingStatus) ?? "undecided") as GradingStatus;
  if (!has(GRADING_STATUSES, gradingStatus)) throw new Error(`Unknown grading status: ${gradingStatus}`);
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
    identification: identification(input.identification),
    manualUngraded: num(input.manualUngraded),
    manualGraded: gradedNums,
    gradingStatus,
  };
}

export function createCard(input: CardInput): CardRecord {
  const c = normalizeInput(input);
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      // name_key is written by the same expression findSimilar reads it with, so
      // the stored value and the old inline `lower(trim(name))` agree exactly.
      `INSERT INTO cards (game, sport, name, name_key, set_name, set_code, card_number, year, rarity, variant,
        language, manufacturer, quantity, condition, grading_company, grade, cert_number, purchase_price,
        notes, image_path, reference_image_url, accent_color, location, external_ids, identification, manual_ungraded, manual_graded,
        grading_status, created_at, updated_at)
       VALUES (@game, @sport, @name, lower(trim(@name)), @setName, @setCode, @cardNumber, @year, @rarity, @variant,
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
  return getCard(Number(result.lastInsertRowid))!;
}

export function updateCard(id: number, patch: Partial<CardInput>): CardRecord | null {
  const existing = getCard(id);
  if (!existing) return null;
  const merged = normalizeInput({ ...existing, ...patch, game: patch.game ?? existing.game, name: patch.name ?? existing.name });
  getDb()
    .prepare(
      `UPDATE cards SET game=@game, sport=@sport, name=@name, name_key=lower(trim(@name)), set_name=@setName, set_code=@setCode,
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
  return getCard(id);
}

/**
 * Cards that look like the same card (same game and name, and a matching
 * number or set when either side has one). Used to catch accidental
 * duplicates when adding.
 */
export function findSimilar(input: { game: Game; name: string; cardNumber?: string | null; setName?: string | null }): CardRecord[] {
  const name = input.name.trim().toLowerCase();
  if (!name) return [];
  // name_key is the stored form of the same expression, so this is an index
  // probe rather than a scan of the whole table — which, once per row, is what
  // made a large CSV import block the process for a minute.
  const rows = getDb()
    .prepare("SELECT * FROM cards WHERE game = ? AND name_key = ? ORDER BY updated_at DESC")
    .all(input.game, name) as CardRow[];
  const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const num = normalizeNumber(input.cardNumber);
  const set = norm(input.setName);
  return rows.map(rowToCard).filter((c) => {
    const cnum = normalizeNumber(c.cardNumber);
    const cset = norm(c.setName);
    if (num && cnum) return num === cnum;
    if (set && cset) return set === cset || set.includes(cset) || cset.includes(set);
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
    if (interchangeable.length === 1) {
      const existing = interchangeable[0];
      const patch: Partial<CardInput> = { quantity: existing.quantity + (clean.quantity || 1) };
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

export function deleteCard(id: number): boolean {
  return getDb().prepare("DELETE FROM cards WHERE id = ?").run(id).changes > 0;
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
    where.push("(name LIKE @q OR set_name LIKE @q OR card_number LIKE @q OR notes LIKE @q OR sport LIKE @q OR location LIKE @q)");
    params.q = `%${opts.search.trim()}%`;
  }
  if (opts.location !== undefined) {
    if (opts.location === "") where.push("(location IS NULL OR trim(location) = '')");
    else {
      where.push("location = @location");
      params.location = opts.location;
    }
  }
  const sql = `SELECT * FROM cards ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC`;
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
  return rows.map(rowToSnapshot).filter((s): s is PriceSnapshot => s !== null);
}

export function latestSnapshot(cardId: number): PriceSnapshot | null {
  return listSnapshots(cardId, 1)[0] ?? null;
}

/** Every snapshot, oldest first (for the portfolio history). */
export function allSnapshots(): PriceSnapshot[] {
  const rows = getDb()
    .prepare("SELECT * FROM price_snapshots ORDER BY fetched_at ASC, id ASC")
    .all() as SnapshotRow[];
  return rows.map(rowToSnapshot).filter((s): s is PriceSnapshot => s !== null);
}

/** Latest snapshot for every card in one query (for the collection view). */
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
    const snapshot = rowToSnapshot(r);
    if (snapshot) map.set(r.card_id, snapshot);
  }
  return map;
}
