import { getDb } from "./db";
import { DEFAULT_SETTINGS, type Settings } from "./types";

const KEY = "settings";

export function getSettings(): Settings {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(KEY) as { value: string } | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  try {
    const parsed: unknown = JSON.parse(row.value);
    const stored = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Partial<Settings>;
    return {
      // Read through the same sanitiser the write path uses. A row can arrive
      // from a restored database rather than from saveSettings, and a
      // multiplier that is a string rather than a number is a price of NaN
      // everywhere it is used — a wrong answer with nothing to report it.
      // Grade rows are fully user-managed (they may remove defaults); condition
      // rows must always cover every condition, so defaults fill any gaps.
      gradeMultipliers: numberMap(stored.gradeMultipliers) ?? { ...DEFAULT_SETTINGS.gradeMultipliers },
      conditionMultipliers: {
        ...DEFAULT_SETTINGS.conditionMultipliers,
        ...(numberMap(stored.conditionMultipliers) ?? {}),
      },
      gradingFee: Number.isFinite(stored.gradingFee) ? Number(stored.gradingFee) : DEFAULT_SETTINGS.gradingFee,
      readyMinUpside: Number.isFinite(stored.readyMinUpside) ? Number(stored.readyMinUpside) : DEFAULT_SETTINGS.readyMinUpside,
      readyMinUpsidePercent: Number.isFinite(stored.readyMinUpsidePercent) ? Number(stored.readyMinUpsidePercent) : DEFAULT_SETTINGS.readyMinUpsidePercent,
      ownerName: typeof stored.ownerName === "string" ? stored.ownerName.slice(0, 120) : DEFAULT_SETTINGS.ownerName,
      alertMovePercent: Number.isFinite(stored.alertMovePercent) ? Number(stored.alertMovePercent) : DEFAULT_SETTINGS.alertMovePercent,
      alertWebhookUrl: typeof stored.alertWebhookUrl === "string" ? stored.alertWebhookUrl : DEFAULT_SETTINGS.alertWebhookUrl,
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: Settings): Settings {
  const clean: Settings = {
    gradeMultipliers: sanitizeNumbers(settings.gradeMultipliers),
    conditionMultipliers: {
      ...DEFAULT_SETTINGS.conditionMultipliers,
      ...sanitizeNumbers(settings.conditionMultipliers),
    } as Settings["conditionMultipliers"],
    gradingFee: nonNegative(settings.gradingFee, DEFAULT_SETTINGS.gradingFee),
    readyMinUpside: nonNegative(settings.readyMinUpside, DEFAULT_SETTINGS.readyMinUpside),
    readyMinUpsidePercent: nonNegative(settings.readyMinUpsidePercent, DEFAULT_SETTINGS.readyMinUpsidePercent),
    ownerName: (typeof settings.ownerName === "string" ? settings.ownerName : "").trim().slice(0, 120),
    alertMovePercent: nonNegative(settings.alertMovePercent, DEFAULT_SETTINGS.alertMovePercent),
    alertWebhookUrl: webhookUrl(settings.alertWebhookUrl),
  };
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(KEY, JSON.stringify(clean));
  return clean;
}

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

function nonNegative(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** A stored map of numbers, or null when it is not a map at all. */
function numberMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return sanitizeNumbers(value as Record<string, unknown>);
}

function sanitizeNumbers(input: Record<string, unknown> | undefined) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const n = typeof v === "number" ? v : Number(v);
    if (k.trim() && Number.isFinite(n) && n >= 0) out[k.trim()] = n;
  }
  return out;
}
