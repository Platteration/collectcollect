/**
 * Optional gate: a single password, sign-in with Google (google-config.ts), or
 * both. Either way in ends in the same signed session cookie, so signing out,
 * signing out everywhere and every check the proxy makes treat them alike.
 *
 * Uses Web Crypto only, so the same code runs wherever the proxy does and in
 * Node route handlers alike.
 *
 * Every app that uses it gets its own cookie name and its own environment
 * variables. That is not tidiness: cookies are scoped to a host and not to a
 * port, so two of these apps served from localhost would otherwise hand each
 * other their sessions, and one password would unlock both collections.
 */

import { googleBinding, readGoogle, type GoogleState, type GoogleVariables } from "./google-config";

export interface AuthConfig {
  /** Cookie the session token is kept in. Must differ per app. */
  cookie: string;
  /** Environment variable holding the password. Must differ per app. */
  passwordEnv: string;
  /** Environment variable holding an explicit signing secret, when there is one. */
  secretEnv: string;
  /** Namespace for the secret derived from the password, when there is no explicit one. */
  secretPrefix: string;
  /**
   * A random signing key kept beside the data (see session-seed.ts), or null
   * when there is nowhere to keep one. Without it the key is derived from the
   * password alone, and a stolen cookie is an offline oracle for guessing it.
   */
  seed?: () => string | null;
  /** How long a login lasts before it has to be repeated. */
  days?: number;
  /**
   * Sign-in with Google, when the app offers it: the variables it reads, and the
   * `__Host-` cookie the sign-in carries its state in between leaving for Google
   * and coming back (kit/http.js serializeCookie).
   */
  google?: { variables: GoogleVariables; cookie: string };
}

/** Sessions that are no longer good: everything issued before a moment, and particular ones by id. */
export interface Revoked {
  before: number;
  ids: readonly string[];
}

export interface Auth {
  SESSION_COOKIE: string;
  SESSION_DAYS: number;
  /** The gate is on: a password is set, or one of the app's Google variables is. */
  authEnabled(): boolean;
  /** A password is set, so the login page asks for it. */
  passwordEnabled(): boolean;
  /** Sign-in with Google as the environment has it now (nothing touched when the app offers none). */
  google(): GoogleState;
  /** The cookie a Google sign-in keeps its state in, or null when the app offers none. */
  GOOGLE_COOKIE: string | null;
  /** The names of the app's Google variables, for the log; null when the app offers none. */
  GOOGLE_VARIABLES: GoogleVariables | null;
  /**
   * The key that seals a Google sign-in's state cookie: a random one this
   * process made, never the session signing key, since anybody can have a
   * state cookie for the asking (google-signin.ts). Null when there is no key
   * to sign a session with (see createToken), so no sign-in is started that
   * could not end in one.
   */
  flowKey(): Promise<Uint8Array | null>;
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

/**
 * How long an explicit signing secret must be, in bytes, where nothing else
 * secret goes into a session's signature: a gate with no password, which only
 * sign-in with Google makes (see signingKey). The kit asks the same of its own
 * SESSION_SECRET (kit/config.js).
 */
export const MIN_SECRET_BYTES = 32;

/**
 * The random key Google sign-in state cookies are sealed with, made once per
 * process. Kept on the global object rather than in a module variable, so
 * that if this module is ever evaluated twice in one process (a development
 * reload evaluates it again; the production build was measured to share one
 * copy between the start and the callback routes), every copy seals and opens
 * with the same key. A sign-in under way when the process restarts finds its
 * cookie unreadable and goes back to the login page.
 */
const FLOW_KEY = Symbol.for("collectcollect.google-sign-in.flow-key");
function processFlowKey(): Uint8Array {
  const holder = globalThis as unknown as Record<symbol, Uint8Array | undefined>;
  let key = holder[FLOW_KEY];
  if (!key) {
    key = new Uint8Array(32);
    crypto.getRandomValues(key);
    holder[FLOW_KEY] = key;
  }
  return key;
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

  /** Each thing worth saying in the log, said once rather than on every request. */
  const said = new Set<string>();
  const warnOnce = (text: string) => {
    if (said.has(text)) return;
    said.add(text);
    console.warn(`[auth] ${text}`);
  };

  const NO_GOOGLE: GoogleState = { touched: false, settings: null, warnings: [] };
  function google(): GoogleState {
    if (!config.google) return NO_GOOGLE;
    const state = readGoogle(config.google.variables);
    state.warnings.forEach(warnOnce);
    return state;
  }

  const enabled = () => Boolean(password()) || google().touched;

  /**
   * The key sessions are signed with: the explicit secret, else the random seed
   * kept beside the data, else one derived from the password. Null when there
   * is none of the three, or the explicit secret is too short to be the only
   * secret, both of which only a gate with no password can reach: Google
   * alone, with a short secret or a data directory where no seed can be kept.
   */
  function signingKey(): string | null {
    const explicit = process.env[config.secretEnv];
    if (explicit) {
      // With no password, the key is the only secret in a session's signature:
      // what it signs is this app's name and who may sign in with Google, which
      // can be guessed. A key a person chose can be too, and then one session
      // cookie, seen once, lets anybody guess it offline and sign sessions of
      // their own, which Sign out everywhere cannot end. With a password the
      // password is in every signature as well, as it always was.
      if (!password() && new TextEncoder().encode(explicit).length < MIN_SECRET_BYTES) {
        warnOnce(`Nobody can sign in: with no password, ${config.secretEnv} is the only secret a session is signed with, and it is shorter than ${MIN_SECRET_BYTES} bytes. Set it to a random value (openssl rand -hex 32), or unset it so a random key is kept in the data directory.`);
        return null;
      }
      return explicit;
    }
    const seed = config.seed?.() ?? null;
    if (seed) return seed;
    if (password()) {
      // No seed and no explicit secret: the old derivation, which is weaker but
      // still better than refusing to sign anyone in. Said once, not per request.
      warnOnce(`Sessions are being signed with a key derived from the password, so a stolen cookie could be used to guess it offline. Make the data directory writable so a random key can be kept there, or set ${config.secretEnv}.`);
      return `${config.secretPrefix}${password()}`;
    }
    // A key derived from no password at all would be one anybody could compute.
    warnOnce(`Nobody can sign in: there is no key to sign sessions with. Make the data directory writable so a random key can be kept there, or set ${config.secretEnv}.`);
    return null;
  }

  async function secret(): Promise<string | null> {
    // Bind every token to this app AND its password, including installations
    // with a separate signing secret, and to who may sign in with Google when
    // anyone may. v2 cookies deliberately expire on upgrade; a gate without
    // Google signs exactly what it signed before Google was offered.
    const settings = google().settings;
    const message = JSON.stringify(settings ? ["session-v3", config.secretPrefix, password(), ...googleBinding(settings)] : ["session-v3", config.secretPrefix, password()]);
    const key = signingKey();
    return key === null ? null : hmac(message, key);
  }

  return {
    SESSION_COOKIE: config.cookie,
    SESSION_DAYS,
    GOOGLE_COOKIE: config.google?.cookie ?? null,
    GOOGLE_VARIABLES: config.google?.variables ?? null,

    authEnabled: enabled,
    passwordEnabled: () => Boolean(password()),
    google,

    async flowKey(): Promise<Uint8Array | null> {
      return signingKey() === null ? null : processFlowKey();
    },

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

    /** Throws when there is no signing key (signingKey), which a gate with a password never lacks. */
    async createToken(now = Date.now()): Promise<string> {
      const key = await secret();
      if (key === null) throw new Error("There is no key to sign sessions with");
      const expires = now + SESSION_DAYS * 86400_000;
      const id = crypto.randomUUID();
      const body = `${expires}.${now}.${id}`;
      return `v3.${body}.${await hmac(body, key)}`;
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
      if (!enabled() || parsed.expires <= now || parsed.issued > now + 60_000 || parsed.expires - parsed.issued > SESSION_DAYS * 86400_000) return false;
      const key = await secret();
      if (key === null) return false;
      if (!timingSafeEqual(parsed.signature, await hmac(`${parsed.expires}.${parsed.issued}.${parsed.id}`, key))) return false;
      if (revoked) {
        if (parsed.issued < revoked.before) return false;
        if (revoked.ids.includes(parsed.id)) return false;
      }
      return true;
    },
  };
}

/**
 * Whether the bearer of this cookie may see the app's own chrome: always when
 * the gate is off, otherwise only with a session the proxy would honour.
 * A revocation record that cannot be read is "no", as it is in the proxy.
 */
export async function signedIn(auth: Auth, token: string | undefined, sessions?: { revoked(): Revoked }): Promise<boolean> {
  if (!auth.authEnabled()) return true;
  let revoked: Revoked | undefined;
  try {
    revoked = sessions?.revoked();
  } catch {
    return false;
  }
  return auth.verifyToken(token, Date.now(), revoked);
}
