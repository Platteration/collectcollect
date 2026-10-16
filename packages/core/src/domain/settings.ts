import type { DomainDb } from "./db";
import { BASE_SETTINGS, type BaseSettings, type DomainSpec, type SettingFieldSpec, type Settings } from "./spec";

const KEY = "settings";

export const BASE_SETTING_FIELDS: SettingFieldSpec[] = [
  { key: "ownerName", label: "Name on the report", type: "text", section: "You" },
  { key: "alertWebhookUrl", label: "Send new alerts to", type: "url", section: "You", placeholder: "https://…", help: "Every alert is POSTed to it as JSON, so you can forward them to email, push or chat." },
  { key: "alertMovePercent", label: "Alert on moves of at least, %", type: "number", section: "When to say something" },
  {
    key: "exportPrivateFields",
    label: "Write private fields to the plain-text copy and exports",
    type: "boolean",
    section: "Privacy",
    help: "Off keeps serial numbers and the like in the database only.",
  },
];

/** Only http(s) URLs are accepted; the server POSTs to this on its own. */
function webhookUrl(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

function nonNegative(v: unknown, fallback: number, below = Infinity): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < below ? n : fallback;
}

function sanitizeNumbers(input: unknown, below = Infinity): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k === "__proto__") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (k.trim() && Number.isFinite(n) && n >= 0 && n < below) out[k.trim()] = n;
  }
  return out;
}

/** Coerce one stored or submitted value to what its field allows, falling back when it cannot. */
export function cleanSetting(field: SettingFieldSpec, value: unknown, fallback: unknown): unknown {
  switch (field.type) {
    case "number":
      return nonNegative(value, Number(fallback), field.below);
    case "text":
      return (typeof value === "string" ? value : String(fallback ?? "")).trim().slice(0, 200);
    case "url":
      return webhookUrl(value);
    case "boolean":
      return typeof value === "boolean" ? value : Boolean(fallback);
    case "numbers":
      return value === undefined ? { ...(fallback as Record<string, number>) } : sanitizeNumbers(value, field.below);
  }
}

export type SettingsStore<S extends object> = ReturnType<typeof createSettings<S>>;

export function createSettings<S extends object>(spec: Pick<DomainSpec<object, S>, "settings">, db: DomainDb) {
  const fields = [...BASE_SETTING_FIELDS, ...spec.settings.fields];
  const defaults = { ...BASE_SETTINGS, ...spec.settings.defaults } as Settings<S>;

  function clean(input: Partial<Settings<S>>, base: Settings<S>): Settings<S> {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    const given = input as Record<string, unknown>;
    for (const field of fields) {
      const value = given[field.key];
      const fallback = (base as Record<string, unknown>)[field.key];
      out[field.key] = value === undefined ? fallback : cleanSetting(field, value, fallback);
    }
    return out as Settings<S>;
  }

  function getSettings(): Settings<S> {
    const row = db.getDb().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
    if (!row) return structuredClone(defaults);
    try {
      return clean(JSON.parse(row.value) as Partial<Settings<S>>, structuredClone(defaults));
    } catch {
      return structuredClone(defaults);
    }
  }

  function saveSettings(settings: Partial<Settings<S>>): Settings<S> {
    const next = clean(settings, getSettings());
    db.getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(next));
    return next;
  }

  /**
   * Check what a form sent before anything is saved. A number the browser
   * could not parse arrives as null (JSON has no NaN); saving around it would
   * drop the field back to a default and still answer "saved".
   */
  function validate(body: Record<string, unknown>): { ok: true } | { ok: false; problems: string[] } {
    const problems: string[] = [];
    const bad = (label: string, value: unknown, below = Infinity) => {
      const n = typeof value === "number" ? value : Number(value);
      return value === null || typeof value === "boolean" || !Number.isFinite(n) || n < 0 || n >= below;
    };
    for (const field of fields) {
      const value = body[field.key];
      if (value === undefined) continue;
      if (field.type === "number" && bad(field.label, value, field.below)) problems.push(field.label);
      if (field.type === "numbers") {
        if (value === null || typeof value !== "object" || Array.isArray(value)) problems.push(field.label);
        else for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (bad(k, v, field.below)) problems.push(`${field.label} (${k})`);
      }
      if (field.type === "boolean" && typeof value !== "boolean") problems.push(field.label);
    }
    return problems.length ? { ok: false, problems } : { ok: true };
  }

  return { fields, defaults, getSettings, saveSettings, validate };
}

export type { BaseSettings };
