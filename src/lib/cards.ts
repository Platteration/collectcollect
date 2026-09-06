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
import { CONDITIONS, GAMES } from "./types";

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
  external_ids: string;
  identification: string | null;
  manual_ungraded: number | null;
  manual_graded: string;
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
    externalIds: parseJson(row.external_ids, {}),
    identification: parseJson<Identification | null>(row.identification, null),
    manualUngraded: row.manual_ungraded,
    manualGraded: parseJson(row.manual_graded, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
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
  if (!game || !(game in GAMES)) throw new Error(`Unknown game: ${input.game}`);
  const name = str(input.name);
  if (!name) throw new Error("Card name is required");
  const condition = (str(input.condition) ?? "NM") as Condition;
  if (!(condition in CONDITIONS)) throw new Error(`Unknown condition: ${condition}`);
  const quantity = Math.max(0, Math.floor(num(input.quantity) ?? 1));
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
    imagePath: str(input.imagePath),
    referenceImageUrl: str(input.referenceImageUrl),
    externalIds: Object.fromEntries(
      Object.entries(input.externalIds ?? {}).filter(([, v]) => str(v)),
    ) as Record<string, string>,
    identification: input.identification ?? null,
    manualUngraded: num(input.manualUngraded),
    manualGraded: gradedNums,
  };
}

export function createCard(input: CardInput): CardRecord {
  const c = normalizeInput(input);
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO cards (game, sport, name, set_name, set_code, card_number, year, rarity, variant,
        language, manufacturer, quantity, condition, grading_company, grade, cert_number, purchase_price,
        notes, image_path, reference_image_url, external_ids, identification, manual_ungraded, manual_graded,
        created_at, updated_at)
       VALUES (@game, @sport, @name, @setName, @setCode, @cardNumber, @year, @rarity, @variant,
        @language, @manufacturer, @quantity, @condition, @gradingCompany, @grade, @certNumber, @purchasePrice,
        @notes, @imagePath, @referenceImageUrl, @externalIds, @identification, @manualUngraded, @manualGraded,
        @now, @now)`,
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
      `UPDATE cards SET game=@game, sport=@sport, name=@name, set_name=@setName, set_code=@setCode,
        card_number=@cardNumber, year=@year, rarity=@rarity, variant=@variant, language=@language,
        manufacturer=@manufacturer, quantity=@quantity, condition=@condition, grading_company=@gradingCompany,
        grade=@grade, cert_number=@certNumber, purchase_price=@purchasePrice, notes=@notes, image_path=@imagePath,
        reference_image_url=@referenceImageUrl, external_ids=@externalIds, identification=@identification,
        manual_ungraded=@manualUngraded, manual_graded=@manualGraded, updated_at=@now
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
}

export function listCards(opts: ListOptions = {}): CardRecord[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.game) {
    where.push("game = @game");
    params.game = opts.game;
  }
  if (opts.search?.trim()) {
    where.push("(name LIKE @q OR set_name LIKE @q OR card_number LIKE @q OR notes LIKE @q OR sport LIKE @q)");
    params.q = `%${opts.search.trim()}%`;
  }
  const sql = `SELECT * FROM cards ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC`;
  return (getDb().prepare(sql).all(params) as CardRow[]).map(rowToCard);
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
