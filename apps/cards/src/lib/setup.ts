import { building, databaseExists, getDb } from "./db";
import { authEnabled } from "./auth";
import { isClaudeConfigured } from "./identify/claude";
export function setupStatus() {
  const defaults = { dismissed: false, hasCards: false, identificationConfigured: isClaudeConfigured(), passwordSet: authEnabled() };
  if (building() || !databaseExists()) return defaults;
  const db = getDb();
  const dismissed = db.prepare("SELECT value FROM settings WHERE key = 'setup_checklist_dismissed'").get() as { value: string } | undefined;
  const count = db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number };
  return { ...defaults, dismissed: dismissed?.value === "true", hasCards: count.n > 0 };
}
export function dismissSetup(dismissed: boolean): void {
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('setup_checklist_dismissed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(dismissed));
}
