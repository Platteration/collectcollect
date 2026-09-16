import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { BusyError } from "./gate";

export interface PriceOutcome { id: number; status: "priced" | "unpriced" | "failed" | "skipped"; message?: string }
export interface PriceJob { id: string; status: "running" | "complete" | "interrupted"; createdAt: string; finishedAt: string | null; total: number; outcomes: PriceOutcome[]; error: string | null }
interface JobRow { id: string; status: PriceJob["status"]; created_at: string; finished_at: string | null; ids: string; outcomes: string; error: string | null }
export function initializePriceJobs(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS price_jobs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT,
    ids TEXT NOT NULL, outcomes TEXT NOT NULL DEFAULT '[]', error TEXT
  ); CREATE UNIQUE INDEX IF NOT EXISTS idx_price_jobs_active ON price_jobs(status) WHERE status='running';`);
}
const decode = (r: JobRow): PriceJob => ({ id: r.id, status: r.status, createdAt: r.created_at,
  finishedAt: r.finished_at, total: (JSON.parse(r.ids) as number[]).length,
  outcomes: JSON.parse(r.outcomes) as PriceOutcome[], error: r.error });

export interface JobRefreshOptions { ids?: number[]; onProgress?: (outcome: PriceOutcome) => void }
const globalJobs = globalThis as unknown as { __collectcollectActiveJobs?: WeakMap<Database.Database, Set<string>> };
const active = (globalJobs.__collectcollectActiveJobs ??= new WeakMap<Database.Database, Set<string>>());
export function createPriceJobs(spec: {
  db: () => Database.Database; ids: () => number[]; running: () => boolean;
  refresh: (options: JobRefreshOptions) => Promise<unknown>;
}) {
  // Track promises by the actual DB connection. A fresh process has none, so
  // unfinished jobs are visibly interrupted rather than pretending to run.
  function recover(db: Database.Database) {
    const known = active.get(db) ?? new Set<string>();
    const rows = db.prepare("SELECT id FROM price_jobs WHERE status='running'").all() as Array<{ id: string }>;
    for (const row of rows) if (!known.has(row.id)) db.prepare("UPDATE price_jobs SET status='interrupted',finished_at=?,error=? WHERE id=?")
      .run(new Date().toISOString(), "The server stopped before this refresh finished. Retry the unfinished items.", row.id);
  }
  const get = (id: string) => { const db = spec.db(); recover(db); const row = db.prepare("SELECT * FROM price_jobs WHERE id=?").get(id) as JobRow | undefined; return row ? decode(row) : null; };
  function latest() { const db = spec.db(); recover(db); const row = db.prepare("SELECT * FROM price_jobs ORDER BY created_at DESC,rowid DESC LIMIT 1").get() as JobRow | undefined; return row ? decode(row) : null; }
  function start(ids?: number[]): PriceJob {
    const db = spec.db(); recover(db);
    if (spec.running() || db.prepare("SELECT 1 FROM price_jobs WHERE status='running'").get()) throw new BusyError("A price refresh is already running.");
    const allowed = new Set(spec.ids());
    const selected = ids === undefined ? [...allowed] : [...new Set(ids)];
    if (selected.some(id => !Number.isSafeInteger(id) || !allowed.has(id))) throw new Error("Choose existing holdings to refresh.");
    const id = randomUUID();
    const running = active.get(db) ?? new Set<string>(); active.set(db, running);
    db.prepare("INSERT INTO price_jobs(id,status,created_at,ids) VALUES(?,'running',?,?)").run(id, new Date().toISOString(), JSON.stringify(selected));
    running.add(id);
    const outcomes = new Map<number, PriceOutcome>();
    const progress = (outcome: PriceOutcome) => {
      if (!selected.includes(outcome.id)) throw new Error("Refresh reported an item outside this job");
      if (!db.open) throw new Error("The collection closed before this refresh finished");
      outcomes.set(outcome.id, outcome);
      db.prepare("UPDATE price_jobs SET outcomes=? WHERE id=?").run(JSON.stringify([...outcomes.values()]), id);
    };
    // The server is a persistent Node process. Keep the existing refresh gate,
    // rate limits and provider pacing; navigating away only stops UI polling.
    const finish = (status: PriceJob["status"], error: string | null = null) => {
      if (db.open) db.prepare("UPDATE price_jobs SET status=?,finished_at=?,error=? WHERE id=?").run(status, new Date().toISOString(), error, id);
    };
    let work: Promise<unknown>;
    try { work = selected.length ? Promise.resolve(spec.refresh({ ids: selected, onProgress: progress })) : Promise.resolve(); }
    catch (error) {
      running.delete(id);
      finish("interrupted", error instanceof Error ? error.message : "Refresh failed");
      throw error;
    }
    void work.then(() => {
      const remaining = new Set(spec.ids());
      let incomplete = false;
      for (const selectedId of selected) if (!outcomes.has(selectedId)) {
        const skipped = !remaining.has(selectedId);
        progress({ id: selectedId, status: skipped ? "skipped" : "failed", message: skipped ? "This holding was removed or sold out." : "This item did not finish. Retry its price." });
        if (!skipped) incomplete = true;
      }
      finish(incomplete ? "interrupted" : "complete", incomplete ? "Some items did not finish. Retry the unfinished prices." : null);
    }).catch((error: unknown) => {
      try { finish("interrupted", error instanceof Error ? error.message : "Refresh failed"); }
      catch (recordError) { console.error("[price-jobs] Could not record interrupted refresh", recordError); }
    }).finally(() => { running.delete(id); });
    const row = db.prepare("SELECT * FROM price_jobs WHERE id=?").get(id) as JobRow;
    return decode(row);
  }
  function retry(id: string) {
    const db = spec.db(); const job = get(id);
    if (!job) throw new Error("Refresh job not found.");
    if (job.status === "running") throw new BusyError("This refresh is still running.");
    const row = db.prepare("SELECT ids FROM price_jobs WHERE id=?").get(id) as { ids: string };
    const done = new Set(job.outcomes.filter(o => o.status === "priced" || o.status === "skipped").map(o => o.id));
    const allowed = new Set(spec.ids());
    return start((JSON.parse(row.ids) as number[]).filter(id => !done.has(id) && allowed.has(id)));
  }
  return { get, latest, start, retry };
}
