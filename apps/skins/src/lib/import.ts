import { intakeItem } from "./items";
import { headerKey, parseCsv } from "@collectcollect/core/csv";
import { CATEGORIES, EXTERIORS, RARITIES, exteriorForFloat, type Category, type Exterior, type ItemInput, type Rarity } from "./types";
import { EXTERIOR_ALIASES, exteriorFromName, guessCategory, isSouvenirName, isStatTrakName, splitName } from "./naming";

// Re-exported so the import preview and the add form agree on what a name says.
export { exteriorFromName, guessCategory };

/**
 * Reading an inventory out of a spreadsheet.
 *
 * The exports people actually have come from trade sites and from their own
 * notes, so the column names vary and the item name is often the only reliable
 * field. That one field carries a lot: Steam's market hash name already says
 * whether an item is StatTrak, whether it is Souvenir, and which wear tier it
 * is in, so anything the file does not spell out is read back out of the name
 * rather than left blank.
 */

/**
 * Column aliases, so an export from another tool usually lands without the
 * owner having to rename anything. First match in the file wins.
 */
const COLUMNS: Record<string, string[]> = {
  name: ["name", "marketname", "markethashname", "item", "itemname", "skin", "title", "fullname"],
  category: ["category", "type", "kind", "itemtype"],
  weapon: ["weapon", "gun"],
  finish: ["finish", "skinname", "pattern name", "patternname"],
  exterior: ["exterior", "wear", "wearname", "condition", "quality"],
  rarity: ["rarity", "grade", "tier"],
  collection: ["collection", "itemset", "set", "case", "container"],
  floatValue: ["float", "floatvalue", "wearvalue", "paintwear"],
  paintSeed: ["seed", "paintseed", "pattern", "patternindex", "patternid"],
  paintIndex: ["paintindex", "skinid", "defindex"],
  nameTag: ["nametag", "customname", "nickname"],
  quantity: ["quantity", "qty", "count", "amount", "copies"],
  purchasePrice: ["purchaseprice", "pricepaid", "cost", "paid", "buyprice", "boughtfor"],
  storageUnit: ["storageunit", "storage", "location", "keptin", "storedin", "account", "where", "unit"],
  tradableAfter: ["tradableafter", "tradelock", "tradelockuntil", "lockeduntil", "tradableon"],
  assetId: ["assetid", "asset", "id"],
  imageUrl: ["image", "imageurl", "icon", "iconurl"],
  notes: ["notes", "comment", "comments", "description"],
};

const CATEGORY_ALIASES: Record<string, Category> = {
  weapon: "weapon",
  gun: "weapon",
  rifle: "weapon",
  pistol: "weapon",
  smg: "weapon",
  shotgun: "weapon",
  sniper: "weapon",
  sniperrifle: "weapon",
  machinegun: "weapon",
  knife: "knife",
  knives: "knife",
  glove: "glove",
  gloves: "glove",
  sticker: "sticker",
  case: "case",
  container: "case",
  weaponcase: "case",
  capsule: "capsule",
  agent: "agent",
  graffiti: "graffiti",
  spray: "graffiti",
  patch: "patch",
  charm: "charm",
  keychain: "charm",
  musickit: "music_kit",
  music: "music_kit",
  pin: "pin",
  collectible: "pin",
  pass: "pass",
  key: "key",
  other: "other",
};

const RARITY_ALIASES: Record<string, Rarity> = {
  consumer: "consumer",
  consumergrade: "consumer",
  white: "consumer",
  industrial: "industrial",
  industrialgrade: "industrial",
  lightblue: "industrial",
  milspec: "mil_spec",
  milspecgrade: "mil_spec",
  blue: "mil_spec",
  restricted: "restricted",
  purple: "restricted",
  classified: "classified",
  pink: "classified",
  covert: "covert",
  red: "covert",
  extraordinary: "extraordinary",
  gold: "extraordinary",
  exceedinglyrare: "extraordinary",
  contraband: "contraband",
};

export interface ImportRow {
  /** Line in the original file, counting the header as line 1. */
  line: number;
  input: ItemInput | null;
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

/** Read a CSV into item inputs, reporting what could not be understood. */
export function previewImport(text: string, defaults: { category?: Category } = {}): ImportPreview {
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
    if (!name) return { line, input: null, problem: "No item name in this row", warning: null };

    const warnings: string[] = [];

    const floatValue = parseFloatCell(value(row, "floatValue"));
    if (value(row, "floatValue") && floatValue === null) {
      warnings.push(`Float "${value(row, "floatValue")}" is not a wear value between 0 and 1, so it was left out`);
    }

    // A float settles the wear tier by itself; a column only matters without one.
    const rawExterior = headerKey(value(row, "exterior"));
    let exterior: Exterior | null = null;
    if (floatValue !== null) {
      exterior = exteriorForFloat(floatValue);
    } else if (rawExterior) {
      exterior = EXTERIOR_ALIASES[rawExterior] ?? (Object.hasOwn(EXTERIORS, rawExterior) ? (rawExterior as Exterior) : null);
      if (!exterior) warnings.push(`Wear "${value(row, "exterior")}" was not recognised, so it was read from the name instead`);
    }
    exterior ??= exteriorFromName(name);

    const rawCategory = headerKey(value(row, "category"));
    const stated = CATEGORY_ALIASES[rawCategory] ?? (rawCategory && Object.hasOwn(CATEGORIES, rawCategory) ? (rawCategory as Category) : null);
    let category = stated ?? guessCategory(name);
    if (!category && (exterior !== null || floatValue !== null)) {
      // Only a weapon, a knife or a pair of gloves has wear at all, so a wear
      // value is itself evidence. Which of the three it is, the name says —
      // knives and gloves carry a star — so anything left is a weapon.
      category = "weapon";
      warnings.push("Nothing said what kind of item this is, but it has a wear value, so it was taken as a weapon");
    }
    const chosen: Category | null = category ?? defaults.category ?? null;
    if (!chosen) {
      return {
        line,
        input: null,
        problem: value(row, "category")
          ? `Unknown kind of item "${value(row, "category")}"`
          : "Nothing says what kind of item this is; choose one to apply to every row",
        warning: null,
      };
    }
    if (rawCategory && !stated) {
      warnings.push(`Kind "${value(row, "category")}" was not recognised, so it was read from the name instead`);
    }

    const rawRarity = headerKey(value(row, "rarity"));
    let rarity: Rarity | null = null;
    if (rawRarity) {
      rarity = RARITY_ALIASES[rawRarity] ?? (Object.hasOwn(RARITIES, rawRarity) ? (rawRarity as Rarity) : null);
      if (!rarity) warnings.push(`Rarity "${value(row, "rarity")}" was not recognised, so it was left out`);
    }

    const quantity = Number(value(row, "quantity") || "1");
    const lock = value(row, "tradableAfter");
    const tradableAfter = lock ? (Number.isNaN(Date.parse(lock)) ? null : new Date(lock).toISOString()) : null;
    if (lock && !tradableAfter) warnings.push(`Trade lock "${lock}" is not a date, so it was left out`);

    const { weapon, finish } = splitName(name);

    return {
      line,
      warning: warnings.length ? warnings.join("; ") : null,
      input: {
        marketHashName: name,
        category: chosen,
        weapon: value(row, "weapon") || weapon,
        finish: value(row, "finish") || finish,
        exterior,
        rarity,
        collection: value(row, "collection") || null,
        // The name is the authority on both: every market prices these
        // variants under their own names, so a file that disagrees with the
        // name is describing an item that does not exist.
        stattrak: isStatTrakName(name),
        souvenir: isSouvenirName(name),
        floatValue,
        paintSeed: parseInteger(value(row, "paintSeed")),
        paintIndex: parseInteger(value(row, "paintIndex")),
        nameTag: value(row, "nameTag") || null,
        quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
        purchasePrice: parseMoney(value(row, "purchasePrice")),
        assetId: value(row, "assetId") || null,
        tradableAfter,
        storageUnit: value(row, "storageUnit") || null,
        imageUrl: value(row, "imageUrl") || null,
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
  updated: number;
  skipped: Array<{ line: number; reason: string }>;
}

/** Apply a preview, joining stacks that are already held. */
export function applyImport(preview: ImportPreview): ImportResult {
  const result: ImportResult = { created: 0, merged: 0, updated: 0, skipped: [] };
  for (const row of preview.rows) {
    if (!row.input) {
      result.skipped.push({ line: row.line, reason: row.problem ?? "Could not be read" });
      continue;
    }
    try {
      result[intakeItem(row.input).result]++;
    } catch (e) {
      result.skipped.push({ line: row.line, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

function parseFloatCell(text: string): number | null {
  if (!text || !/\d/.test(text)) return null;
  const n = Number(text.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function parseInteger(text: string): number | null {
  if (!text || !/\d/.test(text)) return null;
  const n = Number(text.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function parseMoney(text: string): number | null {
  if (!text || !/\d/.test(text)) return null;
  const n = Number(text.replace(/[$£€,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
