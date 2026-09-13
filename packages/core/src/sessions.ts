import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomic-write";
import type { Revoked } from "./auth";

/**
 * Which sessions are no longer good, kept in one small file beside the data.
 *
 * A signed cookie proves this app issued it, not that the owner still wants
 * it honoured: a phone that was lost still holds one. So a sign-out records
 * the session's id, "sign out everywhere" records the moment, and the proxy
 * reads both on every request. A file rather than the database, because the
 * proxy must not open SQLite, and because a value this small is read far more
 * often than written: it is re-read only when the file has changed.
 */
export interface SessionStore {
  revoked(): Revoked;
  /** End every session issued before now. */
  revokeAll(now?: number): void;
  /** End one session; `expires` says when the record itself can be forgotten. */
  revoke(id: string, expires: number, now?: number): void;
}

interface Stored {
  before: number;
  ids: Array<{ id: string; expires: number }>;
}

/** Ids kept at most; a household does not sign out this many phones in a month. */
const KEEP = 200;

const EMPTY: Stored = { before: 0, ids: [] };

export function createSessionStore(file: string | (() => string)): SessionStore {
  const where = typeof file === "string" ? () => file : file;
  let cached: { path: string; mtimeMs: number; size: number; stored: Stored } | null = null;

  function read(): Stored {
    const target = where();
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      cached = null;
      return EMPTY;
    }
    if (cached && cached.path === target && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.stored;
    let stored: Stored = EMPTY;
    try {
      const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as Partial<Stored>;
      stored = {
        before: typeof parsed.before === "number" && Number.isFinite(parsed.before) ? parsed.before : 0,
        ids: Array.isArray(parsed.ids)
          ? parsed.ids.filter((e): e is { id: string; expires: number } => Boolean(e) && typeof e.id === "string" && typeof e.expires === "number")
          : [],
      };
    } catch {
      // An unreadable file revokes nothing; it is rewritten whole by the next change.
    }
    cached = { path: target, mtimeMs: stat.mtimeMs, size: stat.size, stored };
    return stored;
  }

  function write(stored: Stored): void {
    const target = where();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(target, JSON.stringify(stored, null, 2) + "\n");
    cached = null;
  }

  /** Records for sessions that have run out on their own are not worth keeping. */
  function prune(ids: Stored["ids"], now: number): Stored["ids"] {
    const live = ids.filter((e) => e.expires > now);
    live.sort((a, b) => a.expires - b.expires);
    return live.length > KEEP ? live.slice(live.length - KEEP) : live;
  }

  return {
    revoked() {
      const stored = read();
      return { before: stored.before, ids: stored.ids.map((e) => e.id) };
    },
    revokeAll(now = Date.now()) {
      // Everything issued up to and including this instant; a session made in
      // the same millisecond is one made before the owner pressed the button.
      write({ before: now + 1, ids: [] });
    },
    revoke(id, expires, now = Date.now()) {
      const stored = read();
      if (stored.ids.some((e) => e.id === id)) return;
      write({ before: stored.before, ids: prune([...stored.ids, { id, expires }], now) });
    },
  };
}
