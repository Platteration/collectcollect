import { intakeCard } from "./cards";
import { headerKey, parseCsv } from "@collectcollect/core/csv";
import { isCondition, isGame, type CardInput, type Condition, type Game } from "./types";
import { lookup } from "@collectcollect/core/lookup";

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
  condition: ["condition", "cond", "gradecondition"],
  gradingCompany: ["gradingcompany", "grader", "gradingservice", "company"],
  grade: ["grade", "cardgrade"],
  certNumber: ["certnumber", "cert", "certification", "serial"],
  purchasePrice: ["purchaseprice", "pricepaid", "cost", "paid", "buyprice"],
  notes: ["notes", "comment", "comments", "description"],
  // Header matching is exact after normalising, so the phrasings people
  // actually use are listed rather than guessed at with substrings, which
  // would let "Boxed Set" match "box".
  location: [
    "location",
    "storage",
    "box",
    "binder",
    "shelf",
    "keptin",
    "storedin",
    "storagebox",
    "storagelocation",
    "cardlocation",
    "binderpage",
    "boxnumber",
    "boxname",
    "where",
  ],
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
  /** Line in the original file, counting the header as line 1. */
  line: number;
  input: CardInput | null;
  problem: string | null;
  /** Something was assumed rather than read; the row still imports. */
  warning: string | null;
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
  // Keep each row's position in the file so reported line numbers still point
  // at the right place after blank rows are dropped.
  const numbered = parseCsv(text)
    .map((cells, i) => ({ cells, line: i + 1 }))
    .filter((r) => r.cells.some((cell) => cell.trim() !== ""));
  if (numbered.length === 0) return { mapping: {}, unmapped: [], rows: [], total: 0, usable: 0 };

  const headers = numbered[0].cells.map((h) => h.trim());
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

  const rows: ImportRow[] = numbered.slice(1).map(({ cells: row, line }) => {
    const name = value(row, "name");
    if (!name) return { line, input: null, problem: "No card name in this row", warning: null };

    const rawGame = headerKey(value(row, "game"));
    const game = lookup(GAME_ALIASES, rawGame) ?? defaults.game ?? (isGame(rawGame) ? rawGame : null);
    if (!game) {
      return {
        line,
        input: null,
        problem: value(row, "game") ? `Unknown game "${value(row, "game")}"` : "No game column; choose one to apply to every row",
        warning: null,
      };
    }

    const quantity = Number(value(row, "quantity") || "1");
    const { grade, company, asCondition } = readGrade(value(row, "grade"), value(row, "gradingCompany"));
    const conditionText = headerKey(value(row, "condition") || asCondition || "");
    const upper = conditionText.toUpperCase();
    const condition = lookup(CONDITION_ALIASES, conditionText) ?? (isCondition(upper) ? upper : null);

    const warnings: string[] = [];
    if (conditionText && !condition) warnings.push(`Condition "${value(row, "condition") || asCondition}" was not recognised, so Near Mint was assumed`);

    return {
      line,
      warning: warnings.length ? warnings.join("; ") : null,
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
        condition: condition ?? "NM",
        gradingCompany: company,
        grade,
        certNumber: value(row, "certNumber") || null,
        purchasePrice: parseMoney(value(row, "purchasePrice")),
        notes: value(row, "notes") || null,
        location: value(row, "location") || null,
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

const COMPANY_PATTERN = /\b(PSA|BGS|BVG|CGC|SGC|TAG|HGA|ACE)\b/i;

/**
 * A grade cell holds anything from "10" to "PSA 10" to "Gem Mint 10" to "NM".
 * Pull out a number wherever there is one, and only treat the cell as a raw
 * condition when it has no number at all.
 */
function readGrade(cell: string, companyColumn: string): { grade: string | null; company: string | null; asCondition: string } {
  const text = cell.trim();
  const company = companyColumn.trim() || COMPANY_PATTERN.exec(text)?.[1].toUpperCase() || null;
  const number = /(\d+(?:\.\d+)?)/.exec(text)?.[1];
  if (!number) return { grade: null, company: companyColumn.trim() || null, asCondition: text };
  return { grade: number, company, asCondition: "" };
}

function parseMoney(text: string): number | null {
  if (!text || !/\d/.test(text)) return null;
  const n = Number(text.replace(/[$£€,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
