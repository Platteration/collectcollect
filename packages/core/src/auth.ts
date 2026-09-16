/**
 * Optional single-password gate.
 *
 * Uses Web Crypto only, so the same code runs wherever the proxy does and in
 * Node route handlers alike.
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

/** Sessions that are no longer good: everything issued before a moment, and particular ones by id. */
export interface Revoked {
  before: number;
  ids: readonly string[];
}

export interface Auth {
  SESSION_COOKIE: string;
  SESSION_DAYS: number;
  authEnabled(): boolean;
  passwordMatches(submitted: string): Promise<boolean>;
  createToken(now?: number): Promise<string>;
  verifyToken(token: string | undefined | null, now?: number, revoked?: Revoked): Promise<boolean>;
}

/**
 * The parts of a token, or null when it is not one. The format is
 * `v3.<expires>.<issued>.<id>.<signature>`: when it stops being good, when it
 * was made, which one it is, and the proof that this app made it. A token
 * from before the format carried only the first and the last, which is why it
 * could never be revoked short of changing the password.
 */
export function parseToken(token: string | undefined | null): { expires: number; issued: number; id: string; signature: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v3") return null;
  const expires = Number(parts[1]);
  const issued = Number(parts[2]);
  const id = parts[3] ?? "";
  const signature = parts[4] ?? "";
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(issued) || issued < 0 || expires <= issued || !/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(signature)) return null;
  return { expires, issued, id, signature };
}

/** The id inside a token, for revoking that one session; null for anything that is not a token. */
export function tokenId(token: string | undefined | null): string | null {
  return parseToken(token)?.id ?? null;
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

  async function secret(): Promise<string> {
    // Bind every token to this app AND its password, including installations
    // with a separate signing secret. v2 cookies deliberately expire on upgrade.
    return hmac(JSON.stringify(["session-v3", config.secretPrefix, password()]), process.env[config.secretEnv] || `${config.secretPrefix}${password()}`);
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
      const id = crypto.randomUUID();
      const body = `${expires}.${now}.${id}`;
      return `v3.${body}.${await hmac(body, await secret())}`;
    },

    /**
     * A token is good when this app signed it, it has not run out, nothing
     * has revoked every session since it was issued, and it is not one of the
     * sessions revoked by name. The revocation list is the caller's to read —
     * the proxy keeps one beside the data directory — so this stays free of
     * any store of its own.
     */
    async verifyToken(token: string | undefined | null, now = Date.now(), revoked?: Revoked): Promise<boolean> {
      const parsed = parseToken(token);
      if (!parsed) return false;
      if (!password() || parsed.expires <= now || parsed.issued > now + 60_000 || parsed.expires - parsed.issued > SESSION_DAYS * 86400_000) return false;
      if (!timingSafeEqual(parsed.signature, await hmac(`${parsed.expires}.${parsed.issued}.${parsed.id}`, await secret()))) return false;
      if (revoked) {
        if (parsed.issued < revoked.before) return false;
        if (revoked.ids.includes(parsed.id)) return false;
      }
      return true;
    },
  };
}
