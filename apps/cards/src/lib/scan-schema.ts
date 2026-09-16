import type Database from "better-sqlite3";

/** Drafts are work in progress, never holdings. Terminal rows are durable receipts. */
export function initializeScanDrafts(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS scan_drafts (
    id TEXT PRIMARY KEY,
    uploads TEXT NOT NULL,
    accent_color TEXT,
    input TEXT NOT NULL DEFAULT '{}',
    identification TEXT,
    hint TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    message TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    attempt TEXT,
    started_at TEXT,
    card_id INTEGER,
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scan_drafts_status ON scan_drafts(status, created_at);`);
}
