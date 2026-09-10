import { getDb } from "./db";
import { DEFAULT_SETTINGS, type Settings } from "./types";

const KEY = "settings";

export function getSettings(): Settings {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  try {
    const stored = JSON.parse(row.value) as Partial<Settings>;
    return {
      // Every wear tier and every market must always have a number, or an
      // arithmetic gap would show up as a missing value halfway down the spread
      // table. Defaults fill anything the stored copy is missing.
      exteriorMultipliers: { ...DEFAULT_SETTINGS.exteriorMultipliers, ...(stored.exteriorMultipliers ?? {}) },
      marketFees: { ...DEFAULT_SETTINGS.marketFees, ...(stored.marketFees ?? {}) },
      stattrakMultiplier: nonNegative(stored.stattrakMultiplier, DEFAULT_SETTINGS.stattrakMultiplier),
      souvenirMultiplier: nonNegative(stored.souvenirMultiplier, DEFAULT_SETTINGS.souvenirMultiplier),
      ownerName: typeof stored.ownerName === "string" ? stored.ownerName.slice(0, 120) : DEFAULT_SETTINGS.ownerName,
      alertMovePercent: nonNegative(stored.alertMovePercent, DEFAULT_SETTINGS.alertMovePercent),
      spreadMinAmount: nonNegative(stored.spreadMinAmount, DEFAULT_SETTINGS.spreadMinAmount),
      spreadMinPercent: nonNegative(stored.spreadMinPercent, DEFAULT_SETTINGS.spreadMinPercent),
      alertWebhookUrl: typeof stored.alertWebhookUrl === "string" ? stored.alertWebhookUrl : DEFAULT_SETTINGS.alertWebhookUrl,
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: Settings): Settings {
  const clean: Settings = {
    exteriorMultipliers: {
      ...DEFAULT_SETTINGS.exteriorMultipliers,
      ...sanitizeNumbers(settings.exteriorMultipliers),
    } as Settings["exteriorMultipliers"],
    marketFees: {
      ...DEFAULT_SETTINGS.marketFees,
      // A fee is a fraction of the price, so anything at or above 1 would mean
      // a sale that pays nothing or costs money; that is a typo, not a market.
      ...sanitizeNumbers(settings.marketFees, 1),
    } as Settings["marketFees"],
    stattrakMultiplier: nonNegative(settings.stattrakMultiplier, DEFAULT_SETTINGS.stattrakMultiplier),
    souvenirMultiplier: nonNegative(settings.souvenirMultiplier, DEFAULT_SETTINGS.souvenirMultiplier),
    ownerName: (typeof settings.ownerName === "string" ? settings.ownerName : "").trim().slice(0, 120),
    alertMovePercent: nonNegative(settings.alertMovePercent, DEFAULT_SETTINGS.alertMovePercent),
    spreadMinAmount: nonNegative(settings.spreadMinAmount, DEFAULT_SETTINGS.spreadMinAmount),
    spreadMinPercent: nonNegative(settings.spreadMinPercent, DEFAULT_SETTINGS.spreadMinPercent),
    alertWebhookUrl: webhookUrl(settings.alertWebhookUrl),
  };
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
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
