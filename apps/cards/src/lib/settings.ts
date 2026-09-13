import { getDb } from "./db";
import { DEFAULT_SETTINGS, type Settings } from "./types";

const KEY = "settings";

export function getSettings(): Settings {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(KEY) as { value: string } | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  try {
    return sanitize(JSON.parse(row.value) as Partial<Settings>);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: Settings): Settings {
  const clean = sanitize(settings);
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(KEY, JSON.stringify(clean));
  return clean;
}

/**
 * The one set of rules for what a setting may be, applied both when settings
 * are saved and when they are read back. A stored copy can predate a rule, or
 * have been edited by hand; reading it as strictly as it would be saved means
 * a negative fee never reaches the grading verdict from either direction.
 */
export function sanitize(input: Partial<Settings>): Settings {
  return {
    // Grade rows are fully user-managed (they may remove defaults); condition
    // rows must always cover every condition, so defaults fill any gaps.
    gradeMultipliers: input.gradeMultipliers === undefined ? { ...DEFAULT_SETTINGS.gradeMultipliers } : sanitizeNumbers(input.gradeMultipliers),
    conditionMultipliers: {
      ...DEFAULT_SETTINGS.conditionMultipliers,
      ...sanitizeNumbers(input.conditionMultipliers),
    } as Settings["conditionMultipliers"],
    gradingFee: nonNegative(input.gradingFee, DEFAULT_SETTINGS.gradingFee),
    readyMinUpside: nonNegative(input.readyMinUpside, DEFAULT_SETTINGS.readyMinUpside),
    readyMinUpsidePercent: nonNegative(input.readyMinUpsidePercent, DEFAULT_SETTINGS.readyMinUpsidePercent),
    ownerName: (typeof input.ownerName === "string" ? input.ownerName : "").trim().slice(0, 120),
    alertMovePercent: nonNegative(input.alertMovePercent, DEFAULT_SETTINGS.alertMovePercent),
    alertWebhookUrl: webhookUrl(input.alertWebhookUrl),
  };
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

function sanitizeNumbers(input: Record<string, unknown> | undefined) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const n = typeof v === "number" ? v : Number(v);
    if (k.trim() && Number.isFinite(n) && n >= 0) out[k.trim()] = n;
  }
  return out;
}
