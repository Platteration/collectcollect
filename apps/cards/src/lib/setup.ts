import { building, databaseExists, getDb } from "./db";
import { auth } from "./auth";
import { isClaudeConfigured } from "./identify/claude";
export function setupStatus() {
  // The two ways in, each as it is set up: sign-in with Google also turns the
  // gate on, and with it alone there is no password to speak of.
  const defaults = { dismissed: false, hasCards: false, identificationConfigured: isClaudeConfigured(), passwordSet: auth.passwordEnabled(), googleSignIn: auth.google().settings !== null };
  if (building() || !databaseExists()) return defaults;
  const db = getDb();
  const dismissed = db.prepare("SELECT value FROM settings WHERE key = 'setup_checklist_dismissed'").get() as { value: string } | undefined;
  const count = db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number };
  return { ...defaults, dismissed: dismissed?.value === "true", hasCards: count.n > 0 };
}
export function dismissSetup(dismissed: boolean): void {
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('setup_checklist_dismissed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(dismissed));
}
