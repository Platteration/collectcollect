/**
 * Optional single-password gate.
 *
 * Uses Web Crypto only, so the same code runs in the Edge runtime (an app's
 * `proxy.ts`) and in Node route handlers.
 *
 * Every app that uses it gets its own cookie name and its own environment
 * variables. That is not tidiness: cookies are scoped to a host and not to a
 * port, so two of these apps served from localhost would otherwise hand each
 * other their sessions, and one password would unlock both collections.
 */

export interface AuthConfig {
  /** Cookie the session token is kept in. Must differ per app. */
  cookie: string;
  /** Environment variable holding the password. Must differ per app. */
  passwordEnv: string;
  /** Environment variable holding an explicit signing secret, when there is one. */
  secretEnv: string;
  /** Namespace for the secret derived from the password, when there is no explicit one. */
  secretPrefix: string;
  /** How long a login lasts before it has to be repeated. */
  days?: number;
}

export interface Auth {
  SESSION_COOKIE: string;
  SESSION_DAYS: number;
  authEnabled(): boolean;
  passwordMatches(submitted: string): Promise<boolean>;
  createToken(now?: number): Promise<string>;
  verifyToken(token: string | undefined | null, now?: number): Promise<boolean>;
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

export function createAuth(config: AuthConfig): Auth {
  const SESSION_DAYS = config.days ?? 30;

  // Every one of these reads the environment when called rather than when the
  // app starts, so setting a password does not need a restart to take effect —
  // and so a test can turn the gate on and off between cases.
  const password = () => process.env[config.passwordEnv] ?? "";

  function secret(): string {
    // A dedicated secret is better, but deriving one keeps setup to a single
    // variable. Changing the password invalidates existing sessions either way.
    return process.env[config.secretEnv] || `${config.secretPrefix}${password()}`;
  }

  return {
    SESSION_COOKIE: config.cookie,
    SESSION_DAYS,

    authEnabled: () => Boolean(password()),

    /**
     * Compare a submitted password with the configured one. Both sides are
     * hashed with a random per-process key first, so the comparison runs over
     * fixed-length digests regardless of what was submitted.
     */
    async passwordMatches(submitted: string): Promise<boolean> {
      const expected = password();
      if (!expected) return false;
      const nonce = crypto.randomUUID();
      const [a, b] = await Promise.all([hmac(submitted, nonce), hmac(expected, nonce)]);
      return timingSafeEqual(a, b);
    },

    async createToken(now = Date.now()): Promise<string> {
      const expires = now + SESSION_DAYS * 86400_000;
      return `${expires}.${await hmac(String(expires), secret())}`;
    },

    async verifyToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
      if (!token) return false;
      const dot = token.indexOf(".");
      if (dot < 1) return false;
      const expires = Number(token.slice(0, dot));
      if (!Number.isFinite(expires) || expires < now) return false;
      return timingSafeEqual(token.slice(dot + 1), await hmac(String(expires), secret()));
    },
  };
}
