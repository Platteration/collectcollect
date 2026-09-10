import { headerKey, parseCsv } from "../../csv";
import type { Repository } from "../repository";
import type { DomainSpec, FieldSpec, ItemInput } from "../spec";
import { columnOf } from "../spec";
import { bool, listOptionId, num, str } from "../normalize";

/**
 * Reading a collection out of a spreadsheet, with the columns matched by
 * name from the spec: a field's own key, its label, and any spellings the
 * spec lists, so an export from another tool usually lands without editing.
 * Nothing is written until the preview has been seen.
 */

export interface ImportRow<F extends object> {
  line: number;
  input: ItemInput<F> | null;
  problem: string | null;
  warning: string | null;
}

export interface ImportPreview<F extends object> {
  mapping: Record<string, string>;
  unmapped: string[];
  rows: ImportRow<F>[];
  total: number;
  usable: number;
}

export interface ImportResult {
  created: number;
  merged: number;
  skipped: Array<{ line: number; reason: string }>;
}

const BASE_ALIASES: Record<string, string[]> = {
  quantity: ["quantity", "qty", "count", "copies", "howmany", "amount"],
  purchasePrice: ["purchaseprice", "pricepaid", "cost", "paid", "buyprice", "boughtfor", "costeach", "price"],
  location: ["location", "storage", "keptin", "storedin", "storagelocation", "box", "shelf", "cabinet", "where", "binder"],
  notes: ["notes", "note", "comment", "comments", "description"],
  manualValue: ["value", "manualvalue", "yourprice", "estimate", "estimatedvalue", "appraisal"],
};

export function aliasesFor(field: FieldSpec): string[] {
  return [...new Set([headerKey(field.key), headerKey(columnOf(field.key)), headerKey(field.label), ...(field.csvAliases ?? []).map(headerKey)])];
}

/** Read a cell for one field; a warning explains anything assumed, a problem stops the row. */
export function readCell(field: FieldSpec, text: string): { value: unknown; warning?: string; problem?: string } {
  if (!text.trim()) return { value: undefined };
  if (field.parse) {
    try {
      return { value: field.parse(text) };
    } catch (e) {
      return { value: undefined, warning: `${field.label} "${text}" ${e instanceof Error ? e.message : "could not be read"}, so it was left out` };
    }
  }
  switch (field.type) {
    case "enum": {
      const key = headerKey(text);
      const options = field.options ?? {};
      const byId = Object.keys(options).find((id) => headerKey(id) === key);
      const byLabel = Object.entries(options).find(([, label]) => headerKey(label) === key)?.[0];
      const alias = field.aliases?.[key];
      const value = byId ?? byLabel ?? alias ?? null;
      if (value === null) {
        return field.required
          ? { value: undefined, problem: `Unknown ${field.label.toLowerCase()} "${text}"` }
          : { value: undefined, warning: `${field.label} "${text}" was not recognised, so it was left out` };
      }
      return { value };
    }
    case "boolean":
      return { value: bool(text) };
    case "number":
    case "integer": {
      const n = num(text);
      return n === null ? { value: undefined, warning: `${field.label} "${text}" is not a number, so it was left out` } : { value: n };
    }
    case "date":
      return Number.isNaN(Date.parse(text)) ? { value: undefined, warning: `${field.label} "${text}" is not a date, so it was left out` } : { value: text.trim() };
    case "list": {
      const entries = text.split(/[;|\n]/).map((s) => s.trim()).filter(Boolean);
      if (!field.options) return { value: entries };
      const ids = entries.map((e) => listOptionId(field, e));
      const unknown = entries.filter((_, i) => ids[i] === null);
      const value = [...new Set(ids.filter((id): id is string => id !== null))];
      return unknown.length ? { value, warning: `${field.label} "${unknown.join(", ")}" ${unknown.length === 1 ? "was" : "were"} not recognised, so ${unknown.length === 1 ? "it was" : "they were"} left out` } : { value };
    }
    case "json":
      try {
        return { value: JSON.parse(text) };
      } catch {
        return { value: undefined, warning: `${field.label} was not readable JSON, so it was left out` };
      }
    default:
      return { value: str(text) };
  }
}

export function createCsvImport<F extends object, X extends object>(ctx: { spec: Pick<DomainSpec<F>, "fields" | "titleField" | "noun">; repo: Repository<F, X> }) {
  const { spec, repo } = ctx;

  function previewImport(text: string): ImportPreview<F> {
    const numbered = parseCsv(text)
      .map((cells, i) => ({ cells, line: i + 1 }))
      .filter((r) => r.cells.some((cell) => cell.trim() !== ""));
    if (numbered.length === 0) return { mapping: {}, unmapped: [], rows: [], total: 0, usable: 0 };

    const headers = numbered[0].cells.map((h) => h.trim());
    const keys = headers.map(headerKey);
    const mapping: Record<string, string> = {};
    const index: Record<string, number> = {};
    const claim = (target: string, aliases: string[]) => {
      if (index[target] !== undefined) return;
      const at = keys.findIndex((k, i) => aliases.includes(k) && !Object.values(index).includes(i));
      if (at !== -1) {
        mapping[target] = headers[at];
        index[target] = at;
      }
    };
    // Domain fields claim their headers first, so a spec's "price" column is
    // not taken by the base purchase-price aliases.
    const titleField = spec.fields.find((f) => f.key === spec.titleField);
    if (titleField) claim(titleField.key, [...aliasesFor(titleField), "name", "title", "item"]);
    for (const field of spec.fields) if (field.key !== spec.titleField) claim(field.key, aliasesFor(field));
    for (const [target, aliases] of Object.entries(BASE_ALIASES)) claim(target, aliases);

    const mapped = new Set(Object.values(index));
    const unmapped = headers.filter((h, i) => !mapped.has(i) && h !== "");
    const value = (row: string[], target: string): string => (index[target] === undefined ? "" : (row[index[target]] ?? "").trim());

    const rows: ImportRow<F>[] = numbered.slice(1).map(({ cells: row, line }) => {
      const title = value(row, spec.titleField);
      if (!title) return { line, input: null, problem: `No ${spec.noun.singular} name in this row`, warning: null };
      const warnings: string[] = [];
      const domain: Record<string, unknown> = {};
      for (const field of spec.fields) {
        if (index[field.key] === undefined) continue;
        const read = readCell(field, value(row, field.key));
        if (read.problem) return { line, input: null, problem: read.problem, warning: null };
        if (read.warning) warnings.push(read.warning);
        if (read.value !== undefined) domain[field.key] = read.value;
      }
      const quantity = Number(value(row, "quantity") || "1");
      const input = {
        ...(domain as Partial<F>),
        quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
        purchasePrice: parseMoney(value(row, "purchasePrice")),
        location: value(row, "location") || null,
        notes: value(row, "notes") || null,
        manualValue: parseMoney(value(row, "manualValue")),
      } as ItemInput<F>;
      // The normaliser is the authority on what a row means; a row it refuses
      // is reported by line rather than silently dropped.
      try {
        repo.normalize(input);
      } catch (e) {
        return { line, input: null, problem: e instanceof Error ? e.message : String(e), warning: null };
      }
      return { line, input, problem: null, warning: warnings.length ? warnings.join("; ") : null };
    });

    return { mapping, unmapped, rows, total: rows.length, usable: rows.filter((r) => r.input).length };
  }

  function applyImport(preview: ImportPreview<F>): ImportResult {
    const result: ImportResult = { created: 0, merged: 0, skipped: [] };
    for (const row of preview.rows) {
      if (!row.input) {
        result.skipped.push({ line: row.line, reason: row.problem ?? "Could not be read" });
        continue;
      }
      try {
        const outcome = repo.intakeItem(row.input);
        if (outcome.result === "created") result.created++;
        else if (outcome.result === "merged") result.merged++;
        else result.skipped.push({ line: row.line, reason: `Matches more than one ${spec.noun.singular} you own` });
      } catch (e) {
        result.skipped.push({ line: row.line, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return result;
  }

  return { previewImport, applyImport };
}

function parseMoney(text: string): number | null {
  if (!text || !/\d/.test(text)) return null;
  const n = Number(text.replace(/[$£€,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
