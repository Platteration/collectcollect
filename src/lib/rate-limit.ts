/**
 * In-memory limiters for the routes that spend money, hammer someone else's
 * API, or guess a password. This is a single-process, single-user app, so a Map
 * of counters is enough; everything here resets when the process restarts,
 * which is an accepted cost.
 */

import net from "node:net";

export interface RateLimitVerdict {
  ok: boolean;
  /** Seconds until the bucket refills; 0 when the call was allowed. */
  retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Count one use of `name` against a fixed window: the first call opens the
 * window, and the call after `limit` uses inside it is refused with the number
 * of seconds left to wait.
 */
export function rateLimit(name: string, limit: number, windowMs: number, now = Date.now()): RateLimitVerdict {
  const bucket = buckets.get(name);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(name, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

/** How many of each expensive call are allowed per hour. */
export const HOUR_MS = 3600_000;
/** Each identification is a vision + reasoning call to a large model: the one that really costs. */
export const IDENTIFY_PER_HOUR = 30;
/** A whole-collection re-price walks every card against every source. */
export const PRICE_REFRESH_PER_HOUR = 12;
/** Per-card re-pricing, generous enough for a bulk refresh over a selection. */
export const CARD_PRICE_PER_HOUR = 600;
/** Checklist fetches for one set at a time. */
export const SET_REFRESH_PER_HOUR = 60;
/** A restore inflates a whole archive in memory; it is also a rare action. */
export const RESTORE_PER_HOUR = 6;

// --- Login attempts -------------------------------------------------------

/** Failed logins allowed for one client key before it is locked out. */
export const LOGIN_MAX_ATTEMPTS = 8;
export const LOGIN_LOCKOUT_MS = 15 * 60_000;
/** Ceiling across every key, so a guesser who cannot be told apart still hits a wall. */
export const LOGIN_GLOBAL_MAX_ATTEMPTS = 50;
export const LOGIN_GLOBAL_WINDOW_MS = 15 * 60_000;
/** What the first failure costs in wall clock; each further one doubles it. */
export const LOGIN_FAILURE_DELAY_MS = 250;
/** Where that doubling stops, so a bucket cannot hold a request open forever. */
export const LOGIN_FAILURE_MAX_DELAY_MS = 10_000;

const loginAttempts = new Map<string, Bucket>();
let loginGlobal: Bucket = { count: 0, resetAt: 0 };

/**
 * How many reverse proxies in front of this app write `X-Forwarded-For`.
 *
 * Nothing in the App Router exposes the socket address, so the only client
 * identity available is a header — and a header is whatever the client says
 * unless a proxy is known to have written it. Zero means no proxy is trusted,
 * which is the default; TRUST_PROXY means one, the shape of every deployment
 * the README describes.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.TRUSTED_PROXY_HOPS);
  if (Number.isInteger(configured) && configured > 0) return configured;
  return env.TRUST_PROXY ? 1 : 0;
}

/** An `X-Forwarded-For` entry that really is an address, with any port removed. */
function asAddress(entry: string): string | null {
  if (net.isIP(entry)) return entry;
  // `[::1]:8080` and `198.51.100.9:8080` are both legal in a forwarded chain.
  const bare = entry.startsWith("[") ? entry.slice(1).split("]")[0] : entry.split(":").length === 2 ? entry.split(":")[0] : entry;
  return net.isIP(bare) ? bare : null;
}

/**
 * The client's address, or null when this deployment cannot know it.
 *
 * Both halves matter. Every mainstream proxy *appends* to `X-Forwarded-For`
 * rather than rewriting it — nginx's `$proxy_add_x_forwarded_for`, Caddy's
 * reverse_proxy default — so the leftmost entry is whatever the client typed
 * and the rightmost is what the nearest proxy saw. Reading from the left lets
 * an attacker open a fresh bucket per guess, and lets them name the owner's
 * address to pin the owner into a lockout they cannot clear.
 *
 * Falling back to a constant when there is no proxy is no better: every caller
 * then shares one bucket, so eight wrong guesses from a stranger lock the owner
 * out of their own collection. So a client this deployment cannot identify gets
 * no key at all, and the caller skips the per-key bucket rather than sharing
 * one.
 */
export function clientKey(request: Request, env: Record<string, string | undefined> = process.env): string | null {
  const hops = trustedProxyHops(env);
  if (hops === 0) return null;
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // The client is `hops` from the right. A chain shorter than that was not
  // written by the proxies the operator says are there.
  const entry = chain.length >= hops ? chain[chain.length - hops] : undefined;
  return entry ? asAddress(entry) : null;
}

/** True while this key — or the process as a whole — is over its failure budget. */
export function loginBlocked(key: string | null, now = Date.now()): boolean {
  if (loginGlobal.count >= LOGIN_GLOBAL_MAX_ATTEMPTS && now < loginGlobal.resetAt) return true;
  if (key === null) return false;
  const record = loginAttempts.get(key);
  return Boolean(record && record.count >= LOGIN_MAX_ATTEMPTS && now < record.resetAt);
}

/** Count a wrong password, and report how many this key has now spent. */
export function recordLoginFailure(key: string | null, now = Date.now()): number {
  if (now >= loginGlobal.resetAt) loginGlobal = { count: 1, resetAt: now + LOGIN_GLOBAL_WINDOW_MS };
  else loginGlobal.count += 1;

  if (key === null) return loginGlobal.count;

  const record = loginAttempts.get(key);
  const count = record && now < record.resetAt ? record.count + 1 : 1;
  loginAttempts.set(key, { count, resetAt: now + LOGIN_LOCKOUT_MS });

  // Rotating keys must not grow the map without bound.
  if (loginAttempts.size > 1000) {
    for (const [k, v] of loginAttempts) if (now >= v.resetAt) loginAttempts.delete(k);
  }
  return count;
}

/**
 * What a wrong guess costs in wall clock: doubling with each failure, capped.
 *
 * This is the whole throttle when no proxy names the caller, because a refusal
 * would then be a refusal of everyone, the owner included. A cost cannot be
 * turned on someone else.
 */
export function loginFailureDelay(failures: number): number {
  return Math.min(LOGIN_FAILURE_DELAY_MS * 2 ** Math.max(0, failures - 1), LOGIN_FAILURE_MAX_DELAY_MS);
}

/** A correct password clears both counters: the owner is demonstrably here. */
export function clearLoginFailures(key: string | null): void {
  if (key !== null) loginAttempts.delete(key);
  loginGlobal = { count: 0, resetAt: 0 };
}

/** Test hook: forget every counter. */
export function resetLimiters(): void {
  buckets.clear();
  loginAttempts.clear();
  loginGlobal = { count: 0, resetAt: 0 };
}
