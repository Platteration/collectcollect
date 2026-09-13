import { getDb } from "./db";
import { isWebhookUrl } from "@collectcollect/core/net";
import { DEFAULT_SETTINGS, type Settings } from "./types";

const KEY = "settings";

export function getSettings(): Settings {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
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
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(KEY, JSON.stringify(clean));
  return clean;
}

/**
 * The one set of rules for what a setting may be, applied both when settings
 * are saved and when they are read back. A stored copy can predate a rule, or
 * have been edited by hand; reading it as strictly as it would be saved means
 * a fee at or above 1 never reaches the spread table from either direction.
 */
export function sanitize(input: Partial<Settings>): Settings {
  return {
    // Every wear tier and every market must always have a number, or an
    // arithmetic gap would show up as a missing value halfway down the spread
    // table. Defaults fill anything the copy is missing or that fails a rule.
    exteriorMultipliers: {
      ...DEFAULT_SETTINGS.exteriorMultipliers,
      ...sanitizeNumbers(input.exteriorMultipliers),
    } as Settings["exteriorMultipliers"],
    marketFees: {
      ...DEFAULT_SETTINGS.marketFees,
      // A fee is a fraction of the price, so anything at or above 1 would mean
      // a sale that pays nothing or costs money; that is a typo, not a market.
      ...sanitizeNumbers(input.marketFees, 1),
    } as Settings["marketFees"],
    stattrakMultiplier: nonNegative(input.stattrakMultiplier, DEFAULT_SETTINGS.stattrakMultiplier),
    souvenirMultiplier: nonNegative(input.souvenirMultiplier, DEFAULT_SETTINGS.souvenirMultiplier),
    ownerName: (typeof input.ownerName === "string" ? input.ownerName : "").trim().slice(0, 120),
    alertMovePercent: nonNegative(input.alertMovePercent, DEFAULT_SETTINGS.alertMovePercent),
    spreadMinAmount: nonNegative(input.spreadMinAmount, DEFAULT_SETTINGS.spreadMinAmount),
    spreadMinPercent: nonNegative(input.spreadMinPercent, DEFAULT_SETTINGS.spreadMinPercent),
    alertWebhookUrl: webhookUrl(input.alertWebhookUrl),
  };
}

/** Only a public http(s) address is kept; the server POSTs to this on its own. */
function webhookUrl(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s && isWebhookUrl(s) ? new URL(s).toString() : "";
}

function nonNegative(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Keep the numbers that are numbers and drop the rest, so one bad field does
 * not take a whole settings page with it. `below` caps what counts as sane.
 */
function sanitizeNumbers(input: Record<string, unknown> | undefined, below = Infinity) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const n = typeof v === "number" ? v : Number(v);
    if (k.trim() && Number.isFinite(n) && n >= 0 && n < below) out[k.trim()] = n;
  }
  return out;
}
