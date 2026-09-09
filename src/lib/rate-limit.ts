/**
 * In-memory limiters for the routes that spend money, hammer someone else's
 * API, or guess a password. This is a single-process, single-user app, so a Map
 * of counters is enough; everything here resets when the process restarts,
 * which is an accepted cost.
 */

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

// --- Login attempts -------------------------------------------------------

/** Failed logins allowed for one client key before it is locked out. */
export const LOGIN_MAX_ATTEMPTS = 8;
export const LOGIN_LOCKOUT_MS = 15 * 60_000;
/** Ceiling across every key, so rotating a spoofable header still hits a wall. */
export const LOGIN_GLOBAL_MAX_ATTEMPTS = 50;
export const LOGIN_GLOBAL_WINDOW_MS = 15 * 60_000;
/** Every failure costs this much wall clock, whoever sends it. */
export const LOGIN_FAILURE_DELAY_MS = 250;

const loginAttempts = new Map<string, Bucket>();
let loginGlobal: Bucket = { count: 0, resetAt: 0 };

/**
 * The key a login attempt is counted against. `X-Forwarded-For` is set by the
 * client unless a reverse proxy in front of the app overwrites it, so an
 * attacker can mint a fresh key per guess: it is only consulted when the
 * operator sets TRUST_PROXY to say a proxy is really there. Otherwise every
 * attempt shares one key, which is the safe direction for a single-user app.
 */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY) {
    const forwarded = request.headers.get("x-forwarded-for");
    const first = forwarded ? forwarded.split(",")[0].trim() : "";
    if (first) return first;
  }
  return "local";
}

/** True while this key — or the process as a whole — is locked out. */
export function loginBlocked(key: string, now = Date.now()): boolean {
  if (loginGlobal.count >= LOGIN_GLOBAL_MAX_ATTEMPTS && now < loginGlobal.resetAt) return true;
  const record = loginAttempts.get(key);
  return Boolean(record && record.count >= LOGIN_MAX_ATTEMPTS && now < record.resetAt);
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const record = loginAttempts.get(key);
  const count = record && now < record.resetAt ? record.count + 1 : 1;
  loginAttempts.set(key, { count, resetAt: now + LOGIN_LOCKOUT_MS });

  if (now >= loginGlobal.resetAt) loginGlobal = { count: 1, resetAt: now + LOGIN_GLOBAL_WINDOW_MS };
  else loginGlobal.count += 1;

  // Rotating keys must not grow the map without bound.
  if (loginAttempts.size > 1000) {
    for (const [k, v] of loginAttempts) if (now >= v.resetAt) loginAttempts.delete(k);
  }
}

/** A correct password clears both counters: the owner is demonstrably here. */
export function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
  loginGlobal = { count: 0, resetAt: 0 };
}

/** Test hook: forget every counter. */
export function resetLimiters(): void {
  buckets.clear();
  loginAttempts.clear();
  loginGlobal = { count: 0, resetAt: 0 };
}
