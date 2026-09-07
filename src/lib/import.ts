import { intakeCard } from "./cards";
import { headerKey, parseCsv } from "./csv";
import { CONDITIONS, GAMES, type CardInput, type Condition, type Game } from "./types";

/**
 * Column aliases, so an export from another collection tool usually lands
 * without the owner having to rename anything. First match in the file wins.
 */
const COLUMNS: Record<string, string[]> = {
  name: ["name", "cardname", "card", "productname", "player", "title"],
  game: ["game", "category", "tcg", "product", "gamename"],
  sport: ["sport"],
  setName: ["set", "setname", "edition", "expansion", "series", "productline"],
  setCode: ["setcode", "setabbreviation", "code"],
  cardNumber: ["number", "cardnumber", "collectornumber", "no", "cardno"],
  year: ["year", "season"],
  rarity: ["rarity"],
  variant: ["variant", "printing", "finish", "parallel", "foil"],
  language: ["language", "lang"],
  manufacturer: ["manufacturer", "brand", "publisher"],
  quantity: ["quantity", "qty", "count", "copies"],
  condition: ["condition", "cond", "grade condition"],
  gradingCompany: ["gradingcompany", "grader", "gradingservice", "company"],
  grade: ["grade", "cardgrade"],
  certNumber: ["certnumber", "cert", "certification", "serial"],
  purchasePrice: ["purchaseprice", "pricepaid", "cost", "paid", "buyprice"],
  notes: ["notes", "comment", "comments", "description"],
};

const GAME_ALIASES: Record<string, Game> = {
  pokemon: "pokemon",
  pokmon: "pokemon",
  pokemontcg: "pokemon",
  yugioh: "yugioh",
  yugi: "yugioh",
  ygo: "yugioh",
  mtg: "mtg",
  magic: "mtg",
  magicthegathering: "mtg",
  sports: "sports",
  baseball: "sports",
  basketball: "sports",
  football: "sports",
  hockey: "sports",
  soccer: "sports",
  other: "other",
};

const CONDITION_ALIASES: Record<string, Condition> = {
  nm: "NM",
  nearmint: "NM",
  mint: "NM",
  m: "NM",
  nmm: "NM",
  lp: "LP",
  lightlyplayed: "LP",
  ex: "LP",
  excellent: "LP",
  mp: "MP",
  moderatelyplayed: "MP",
  vg: "MP",
  good: "MP",
  hp: "HP",
  heavilyplayed: "HP",
  poor: "HP",
  dmg: "DMG",
  damaged: "DMG",
};

export interface ImportRow {
  line: number;
  input: CardInput | null;
  problem: string | null;
}

export interface ImportPreview {
  /** Header name found for each field the file supplies. */
  mapping: Record<string, string>;
  unmapped: string[];
  rows: ImportRow[];
  total: number;
  usable: number;
}

/** Read a CSV into card inputs, reporting what could not be understood. */
export function previewImport(text: string, defaults: { game?: Game } = {}): ImportPreview {
  const table = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (table.length === 0) return { mapping: {}, unmapped: [], rows: [], total: 0, usable: 0 };

  const headers = table[0].map((h) => h.trim());
  const keys = headers.map(headerKey);
  const mapping: Record<string, string> = {};
  const index: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    const at = keys.findIndex((k) => aliases.includes(k));
    if (at !== -1) {
      mapping[field] = headers[at];
      index[field] = at;
    }
  }
  const mappedColumns = new Set(Object.values(index));
  const unmapped = headers.filter((_, i) => !mappedColumns.has(i) && headers[i] !== "");

  const value = (row: string[], field: string): string => (index[field] === undefined ? "" : (row[index[field]] ?? "").trim());

  const rows: ImportRow[] = table.slice(1).map((row, i) => {
    const line = i + 2; // 1-based, and the header is line 1
    const name = value(row, "name");
    if (!name) return { line, input: null, problem: "No card name in this row" };

    const rawGame = headerKey(value(row, "game"));
    const game = GAME_ALIASES[rawGame] ?? defaults.game ?? (rawGame && rawGame in GAMES ? (rawGame as Game) : null);
    if (!game) {
      return { line, input: null, problem: value(row, "game") ? `Unknown game "${value(row, "game")}"` : "No game column; choose one to apply to every row" };
    }

    const quantity = Number(value(row, "quantity") || "1");
    const grade = value(row, "grade");
    // A grade column sometimes holds a raw condition instead, e.g. "NM".
    const gradeIsCondition = grade !== "" && !/^\d/.test(grade);
    const conditionText = headerKey(value(row, "condition") || (gradeIsCondition ? grade : ""));

    return {
      line,
      input: {
        game,
        name,
        sport: value(row, "sport") || null,
        setName: value(row, "setName") || null,
        setCode: value(row, "setCode") || null,
        cardNumber: value(row, "cardNumber") || null,
        year: Number(value(row, "year")) || null,
        rarity: value(row, "rarity") || null,
        variant: value(row, "variant") || null,
        language: value(row, "language") || null,
        manufacturer: value(row, "manufacturer") || null,
        quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
        condition: CONDITION_ALIASES[conditionText] ?? (conditionText.toUpperCase() in CONDITIONS ? (conditionText.toUpperCase() as Condition) : "NM"),
        gradingCompany: gradeIsCondition ? null : value(row, "gradingCompany") || null,
        grade: gradeIsCondition ? null : grade || null,
        certNumber: value(row, "certNumber") || null,
        purchasePrice: parseMoney(value(row, "purchasePrice")),
        notes: value(row, "notes") || null,
      },
      problem: null,
    };
  });

  return { mapping, unmapped, rows, total: rows.length, usable: rows.filter((r) => r.input).length };
}

export interface ImportResult {
  created: number;
  merged: number;
  skipped: Array<{ line: number; reason: string }>;
}

/** Apply a preview, merging into existing cards where they are interchangeable. */
export function applyImport(preview: ImportPreview): ImportResult {
  const result: ImportResult = { created: 0, merged: 0, skipped: [] };
  for (const row of preview.rows) {
    if (!row.input) {
      result.skipped.push({ line: row.line, reason: row.problem ?? "Could not be read" });
      continue;
    }
    try {
      const outcome = intakeCard(row.input);
      if (outcome.result === "created") result.created++;
      else if (outcome.result === "merged") result.merged++;
      else result.skipped.push({ line: row.line, reason: `${row.input.name} matches more than one card you own` });
    } catch (e) {
      result.skipped.push({ line: row.line, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

function parseMoney(text: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[$£€,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
