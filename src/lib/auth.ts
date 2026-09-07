/**
 * Optional single-password gate. Set APP_PASSWORD to require a login; leave it
 * unset and the app behaves exactly as before.
 *
 * Uses Web Crypto only, so the same code runs in the Edge runtime (proxy.ts)
 * and in Node route handlers.
 */

export const SESSION_COOKIE = "cc_session";
/** How long a login lasts before it has to be repeated. */
export const SESSION_DAYS = 30;

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function secret(): string {
  // A dedicated secret is better, but deriving one keeps setup to a single
  // variable. Changing the password invalidates existing sessions either way.
  return process.env.APP_SECRET || `collectcollect:${process.env.APP_PASSWORD ?? ""}`;
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

export async function createToken(now = Date.now()): Promise<string> {
  const expires = now + SESSION_DAYS * 86400_000;
  return `${expires}.${await hmac(String(expires), secret())}`;
}

export async function verifyToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const expires = Number(token.slice(0, dot));
  if (!Number.isFinite(expires) || expires < now) return false;
  return timingSafeEqual(token.slice(dot + 1), await hmac(String(expires), secret()));
}
