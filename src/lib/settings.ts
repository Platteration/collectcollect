import { getDb } from "./db";
import { DEFAULT_SETTINGS, type Settings } from "./types";

const KEY = "settings";

export function getSettings(): Settings {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(KEY) as { value: string } | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  try {
    const stored = JSON.parse(row.value) as Partial<Settings>;
    return {
      // Grade rows are fully user-managed (they may remove defaults); condition
      // rows must always cover every condition, so defaults fill any gaps.
      gradeMultipliers: stored.gradeMultipliers ?? { ...DEFAULT_SETTINGS.gradeMultipliers },
      conditionMultipliers: {
        ...DEFAULT_SETTINGS.conditionMultipliers,
        ...(stored.conditionMultipliers ?? {}),
      },
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
  };
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(KEY, JSON.stringify(clean));
  return clean;
}

function sanitizeNumbers(input: Record<string, unknown> | undefined) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const n = typeof v === "number" ? v : Number(v);
    if (k.trim() && Number.isFinite(n) && n >= 0) out[k.trim()] = n;
  }
  return out;
}
