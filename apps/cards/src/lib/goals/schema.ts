import type Database from "better-sqlite3";

/** Additive: older collections and backups acquire these tables on opening. */
export function initializeGoalSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collecting_goals (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goal_items (
      id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES collecting_goals(id) ON DELETE CASCADE,
      identity TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(goal_id, identity)
    );
  `);
}
