/**
 * Optional single-password gate. Set APP_PASSWORD to require a login; leave it
 * unset and the app behaves exactly as before.
 *
 * Both the proxy and the Node route handlers import this module. The hashing is
 * Web Crypto, which is available to either; the signing key is read from the
 * data directory, which the proxy can reach because Next runs it on the Node.js
 * runtime.
 */

import fs from "node:fs";
import path from "node:path";

export const SESSION_COOKIE = "cc_session";
/** How long a login lasts before it has to be repeated. */
export const SESSION_DAYS = 30;

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

/**
 * The signing key kept beside the data, generated on first use.
 *
 * Deriving the key from the password alone keeps setup to a single variable,
 * but it also means the cookie is a known plaintext (its own expiry) signed
 * with a key made of the password: one captured cookie is then an offline
 * password-guessing oracle with no rate limit at all. A random 256-bit seed
 * removes that, and mixing the password into it keeps the property that
 * changing the password ends every existing session.
 */
function seedFile(): string {
  // Deliberately not `dataDir()` from ./db: that module loads better-sqlite3,
  // which has no business in the proxy's bundle.
  const dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "data");
  return path.join(dir, "session-secret");
}

let cachedSeed: string | null = null;

/** The stored seed, creating it if this is the first login. Null if it cannot be kept. */
function sessionSeed(): string | null {
  if (cachedSeed) return cachedSeed;
  const file = seedFile();
  const read = () => {
    try {
      return fs.readFileSync(file, "utf8").trim() || null;
    } catch {
      return null;
    }
  };
  const existing = read();
  if (existing) return (cachedSeed = existing);
  try {
    const fresh = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // `wx` fails rather than overwriting, so two workers racing on first boot
    // cannot each install a key and invalidate the other's sessions.
    fs.writeFileSync(file, `${fresh}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return (cachedSeed = fresh);
  } catch {
    // Lost the race, or the data directory is read-only.
    return (cachedSeed = read());
  }
}

/** Test hook: forget the seed read from disk. */
export function resetSessionSeed(): void {
  cachedSeed = null;
  cachedRevoked = null;
}

function revokedFile(): string {
  return path.join(path.dirname(seedFile()), "revoked-sessions");
}

/** A ceiling on the revocation list that does not depend on reasoning about it. */
const MAX_REVOKED = 1000;

let cachedRevoked: { at: number; ids: Set<string> } | null = null;

function readRevoked(): Array<[string, number]> {
  try {
    return fs
      .readFileSync(revokedFile(), "utf8")
      .split("\n")
      .map((line) => line.trim().split(" "))
      .filter((parts) => parts.length === 2 && Number.isFinite(Number(parts[1])))
      .map((parts) => [parts[0], Number(parts[1])] as [string, number]);
  } catch {
    return [];
  }
}

/**
 * The identifiers signing out has retired. Read from disk when the file has
 * changed, because the proxy and the route handlers are separate bundles with
 * their own module state: a sign-out in one must be seen by the other.
 */
function revokedIds(): Set<string> {
  let at: number;
  try {
    at = fs.statSync(revokedFile()).mtimeMs;
  } catch {
    cachedRevoked = null;
    return new Set();
  }
  if (cachedRevoked && cachedRevoked.at === at) return cachedRevoked.ids;
  const ids = new Set(readRevoked().map(([id]) => id));
  cachedRevoked = { at, ids };
  return ids;
}

async function secret(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  // However the key is supplied, the password is mixed into it, so rotating the
  // password ends every existing session — which is what the README tells the
  // owner to do about a leaked cookie. Returning APP_SECRET unmixed used to
  // make that promise silently false for anyone who set one.
  if (process.env.APP_SECRET) return await hmac(password, process.env.APP_SECRET);
  const seed = sessionSeed();
  // Without a place to keep a seed this is the old, weaker derivation, which is
  // still better than refusing to sign anyone in.
  return seed ? await hmac(password, seed) : `collectcollect:${password}`;
}

/**
 * Whether the session cookie is marked Secure. The scheme in `request.url` is
 * only the truth when this process terminates TLS itself; behind the reverse
 * proxy the README suggests, the origin request arrives over plain HTTP and the
 * flag would silently be dropped. X-Forwarded-Proto is believed only when
 * TRUST_PROXY says a proxy really is in front — the same rule the login limiter
 * uses — and COOKIE_SECURE settles it either way.
 */
export function cookieSecure(request: Request): boolean {
  const configured = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (configured) return configured !== "0" && configured !== "false";
  if (process.env.TRUST_PROXY) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
    if (proto) return proto === "https";
  }
  return request.url.startsWith("https://");
}

async function hmac(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time equality that does not leak length through early exit. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Compare a submitted password with the configured one. Both sides are hashed
 * with a random per-process key first, so the comparison runs over fixed-length
 * digests regardless of what was submitted.
 */
export async function passwordMatches(submitted: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) return false;
  const nonce = crypto.randomUUID();
  const [a, b] = await Promise.all([hmac(submitted, nonce), hmac(expected, nonce)]);
  return timingSafeEqual(a, b);
}

/**
 * A token is `<expires>.<id>.<signature over "expires.id">`.
 *
 * The identifier is what makes signing out mean something: without it every
 * token with the same expiry is the same token, so clearing the cookie in one
 * browser leaves a captured copy working for the rest of its thirty days, and
 * there is nothing to name in a revocation list.
 */
export async function createToken(now = Date.now()): Promise<string> {
  const expires = now + SESSION_DAYS * 86400_000;
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const payload = `${expires}.${id}`;
  return `${payload}.${await hmac(payload, await secret())}`;
}

function splitToken(token: string): { payload: string; expires: number; id: string; signature: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawExpires, id, signature] = parts;
  const expires = Number(rawExpires);
  if (!Number.isFinite(expires) || !id || !signature) return null;
  return { payload: `${rawExpires}.${id}`, expires, id, signature };
}

export async function verifyToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parsed = splitToken(token);
  if (!parsed || parsed.expires < now) return false;
  if (revokedIds().has(parsed.id)) return false;
  return timingSafeEqual(parsed.signature, await hmac(parsed.payload, await secret()));
}

/**
 * Record that this token is no longer to be accepted, and say whether it was.
 *
 * Only a token that verifies is written down: signing out is reachable without
 * a session, so anything else would let a stranger grow this file one made-up
 * token at a time. Entries past their expiry are dropped on every write and an
 * id is never listed twice, so the file holds at most one line per real sign-in
 * inside a thirty-day window — and MAX_REVOKED bounds it whatever happens.
 *
 * Best effort, like the seed: a data directory that cannot be written to must
 * not make signing out throw.
 */
export async function revokeToken(token: string | undefined | null): Promise<boolean> {
  const parsed = token ? splitToken(token) : null;
  if (!parsed || !(await verifyToken(token))) return false;
  const now = Date.now();
  const kept = readRevoked().filter(([id, expires]) => expires > now && id !== parsed.id);
  kept.push([parsed.id, parsed.expires]);
  try {
    fs.mkdirSync(path.dirname(revokedFile()), { recursive: true });
    const lines = kept.slice(-MAX_REVOKED).map(([id, expires]) => `${id} ${expires}`);
    fs.writeFileSync(revokedFile(), `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    /* nothing can be kept here; the cookie is still cleared in the browser */
  }
  cachedRevoked = null;
  return true;
}
