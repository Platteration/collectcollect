import type { DomainSpec, FieldSpec, Identification, ItemInput, NormalizedItem } from "./spec";
import { columnOf } from "./spec";

/**
 * Turn what a client sent into a record the engine will store, field by
 * field from the spec. Unknown enum values, out-of-range numbers and missing
 * required fields throw; everything else is coerced or dropped.
 */

const UPLOAD_NAME = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;

export function isValidUploadName(name: string): boolean {
  return UPLOAD_NAME.test(name);
}

export const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

export const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export const bool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const text = str(v)?.toLowerCase();
  return text === "true" || text === "yes" || text === "y" || text === "1" || text === "x" || text === "on";
};

/** Only http(s) URLs may be stored for rendering as links or images. */
export const httpUrl = (v: unknown): string | null => {
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
export const hexColor = (v: unknown): string | null => {
  const s = str(v);
  return s && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
};

/** An ISO date, or null when the input is not a date at all. */
export const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  // A bare day ("2026-09-07") is taken as noon local rather than UTC midnight,
  // which reads as the day before across half the world.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The option id an entry names, by id, label or alias; null when it is none of them. */
export function listOptionId(field: Pick<FieldSpec, "options" | "aliases">, entry: string): string | null {
  const options = field.options ?? {};
  const key = entry.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (Object.hasOwn(options, entry.trim())) return entry.trim();
  for (const [id, label] of Object.entries(options)) {
    if (id.toLowerCase().replace(/[^a-z0-9]/g, "") === key || label.toLowerCase().replace(/[^a-z0-9]/g, "") === key) return id;
  }
  const alias = field.aliases?.[key];
  return alias && Object.hasOwn(options, alias) ? alias : null;
}

export function normalizeField(field: FieldSpec, raw: unknown): unknown {
  const missing = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0);
  if (missing) {
    if (field.type === "boolean") return field.default === true;
    if (field.type === "list") return Array.isArray(field.default) ? field.default : [];
    if (field.default !== undefined && field.default !== null) return field.default;
    if (field.required) throw new Error(`${field.label} is required`);
    return null;
  }
  switch (field.type) {
    case "text":
      return str(raw);
    case "number": {
      const n = num(raw);
      if (n === null) throw new Error(`${field.label} must be a number`);
      if (field.min !== undefined && n < field.min) throw new Error(`${field.label} must be at least ${field.min}`);
      if (field.max !== undefined && n > field.max) throw new Error(`${field.label} must be at most ${field.max}`);
      return n;
    }
    case "integer": {
      const n = num(raw);
      if (n === null) throw new Error(`${field.label} must be a whole number`);
      const i = Math.floor(n);
      if (field.min !== undefined && i < field.min) throw new Error(`${field.label} must be at least ${field.min}`);
      if (field.max !== undefined && i > field.max) throw new Error(`${field.label} must be at most ${field.max}`);
      return i;
    }
    case "boolean":
      return bool(raw);
    case "enum": {
      const value = str(raw);
      if (value === null) return null;
      // Object.hasOwn, not `in`: "constructor" is on every object's prototype.
      if (!field.options || !Object.hasOwn(field.options, value)) throw new Error(`Unknown ${field.label.toLowerCase()}: ${value}`);
      return value;
    }
    case "date": {
      const d = isoDate(raw);
      if (d === null) throw new Error(`${field.label} is not a valid date`);
      return d;
    }
    case "list": {
      const list = (Array.isArray(raw) ? raw : String(raw).split(/[\n;|]/)).map((v) => str(v)).filter((v): v is string => v !== null);
      if (!field.options) return list;
      // A list with options is a multi-select: every entry has to be one of them, by id, label or alias.
      const out: string[] = [];
      for (const entry of list) {
        const id = listOptionId(field, entry);
        if (id === null) throw new Error(`Unknown ${field.label.toLowerCase()}: ${entry}`);
        if (!out.includes(id)) out.push(id);
      }
      return out;
    }
    case "json":
      return raw;
  }
}

export function normalizeInput<F extends object, S extends object, X extends object, Q>(
  spec: DomainSpec<F, S, X, Q>,
  input: ItemInput<F>,
): NormalizedItem<F> {
  const domain: Record<string, unknown> = {};
  for (const field of spec.fields) {
    domain[field.key] = normalizeField(field, (input as Record<string, unknown>)[field.key]);
  }
  const manualPrices: Record<string, number> = {};
  for (const [k, v] of Object.entries(input.manualPrices ?? {})) {
    const n = num(v);
    if (n !== null && n >= 0 && k.trim()) manualPrices[k.trim()] = n;
  }
  const photos = (Array.isArray(input.photos) ? input.photos : []).filter((p): p is string => typeof p === "string" && isValidUploadName(p));
  const manualValue = num(input.manualValue);
  const base = {
    quantity: Math.max(0, Math.floor(num(input.quantity) ?? 1)),
    purchasePrice: num(input.purchasePrice),
    notes: str(input.notes),
    location: str(input.location)?.slice(0, 120) ?? null,
    photos,
    referenceImageUrl: httpUrl(input.referenceImageUrl),
    accentColor: hexColor(input.accentColor),
    externalIds: Object.fromEntries(Object.entries(input.externalIds ?? {}).filter(([, v]) => str(v))) as Record<string, string>,
    identification: (input.identification ?? null) as Identification | null,
    manualValue: manualValue !== null && manualValue >= 0 ? manualValue : null,
    manualPrices,
  };
  let clean = { ...base, ...(domain as F) } as NormalizedItem<F>;
  if (spec.normalize) clean = spec.normalize(clean);
  // A unique object is one object. Letting a quantity of 3 through would put
  // three copies of one serial number in the ledger.
  if (spec.isUnique(clean)) clean.quantity = Math.min(1, clean.quantity);
  return clean;
}

/** The parameters for an INSERT or UPDATE, keyed by column. */
export function toRow<F extends object>(spec: Pick<DomainSpec<F>, "fields">, item: NormalizedItem<F>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    quantity: item.quantity,
    purchase_price: item.purchasePrice,
    notes: item.notes,
    location: item.location,
    photos: JSON.stringify(item.photos),
    reference_image_url: item.referenceImageUrl,
    accent_color: item.accentColor,
    external_ids: JSON.stringify(item.externalIds),
    identification: item.identification ? JSON.stringify(item.identification) : null,
    manual_value: item.manualValue,
    manual_prices: JSON.stringify(item.manualPrices),
  };
  const values = item as unknown as Record<string, unknown>;
  for (const field of spec.fields) {
    const v = values[field.key];
    row[columnOf(field.key)] = encodeColumn(field, v);
  }
  return row;
}

export function encodeColumn(field: FieldSpec, v: unknown): unknown {
  switch (field.type) {
    case "boolean":
      return v ? 1 : 0;
    case "json":
      return v === null || v === undefined ? null : JSON.stringify(v);
    case "list":
      return JSON.stringify(Array.isArray(v) ? v : []);
    default:
      return v ?? null;
  }
}

export function decodeColumn(field: FieldSpec, v: unknown): unknown {
  switch (field.type) {
    case "boolean":
      return v === 1 || v === true;
    case "json":
      return parseJson(v as string | null, null);
    case "list": {
      const list = parseJson<unknown>(v as string | null, []);
      return Array.isArray(list) ? list.map(String) : [];
    }
    default:
      return v ?? null;
  }
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
