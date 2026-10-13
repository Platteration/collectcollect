/**
 * The two routes of a sign-in with Google: leaving for Google, and coming back.
 *
 * OpenID Connect's code flow with PKCE, a state and a nonce, through the kit's
 * own modules (kit/google.js for the protocol and Google's keys, kit/crypto.js
 * and kit/http.js for the bytes and the cookie), which are copied byte for
 * byte from the canonical kit and never edited here. What the kit's app.js
 * adds on top — its own sessions, users and purchases — is not used: an
 * account Google vouches for and the app's list allows gets the app's own
 * session cookie, the same one the password gives (auth.ts), so signing out,
 * signing out everywhere and the proxy's checks need nothing new.
 *
 * Every refusal sends the browser back to the login page with
 * `?signin=failed`, and names what failed in the log in the kit's own words,
 * never in Google's.
 */

import { base64url, fromBase64url, fromUtf8, hmacSha256, hmacVerify, randomId, safeEqual, utf8 } from "./kit/crypto.js";
import { clearCookie, isRecord, parseCookies, serializeCookie } from "./kit/http.js";
import { AuthError, authorizeUrl, createKeyCache, exchangeCode, pkcePair, verifyIdToken, type Fetch } from "./kit/google.js";
import type { Auth } from "./auth";
import { allowed, returnPath } from "./google-config";
import { cookieSecure } from "./net";
import { createThrottle } from "./throttle";

/** How long a sign-in may spend at Google, in seconds: the life of its state cookie. */
const FLOW_SECONDS = 600;

/** What the state cookie carries between leaving for Google and coming back. */
interface Flow {
  /** state, compared with what Google hands back */
  s: string;
  /** nonce, which the ID token must carry */
  n: string;
  /** the PKCE verifier */
  v: string;
  /** where to go once signed in (returnPath) */
  r: string;
  /** when the cookie stops being good, in milliseconds */
  e: number;
}

/**
 * The flow, signed (not encrypted: it holds only the visitor's own state, nonce
 * and verifier, in a cookie no script can read) with an HMAC under the random
 * key auth.flowKey() makes once per process, over the cookie's name and the
 * payload. Never under the session signing key: the start route answers anyone,
 * so it would hand every visitor a MAC of known text under that key, to guess
 * it offline, and a guessed key signs sessions. The cookie's name keeps one
 * app's flow from being read as another's.
 */
async function seal(flow: Flow, key: Uint8Array, cookie: string): Promise<string> {
  const payload = base64url(utf8(JSON.stringify(flow)));
  return `${payload}.${base64url(await hmacSha256(key, `${cookie}.${payload}`))}`;
}

/** The flow a cookie carries, when this process sealed it for this cookie and it has not run out; null otherwise. */
async function open(value: string, key: Uint8Array, cookie: string, now: number): Promise<Flow | null> {
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const mac = fromBase64url(value.slice(dot + 1));
  if (!mac || mac.length !== 32 || !(await hmacVerify(key, `${cookie}.${payload}`, mac))) return null;
  const bytes = fromBase64url(payload);
  const text = bytes && fromUtf8(bytes);
  if (!text) return null;
  let flow: unknown;
  try {
    flow = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(flow)) return null;
  const { s, n, v, r, e } = flow;
  if (typeof s !== "string" || typeof n !== "string" || typeof v !== "string" || typeof r !== "string" || typeof e !== "number") return null;
  if (e <= now) return null;
  return { s, n, v, r, e };
}

/** A redirect a browser follows, with the cookies to set on the way. */
function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export interface GoogleRouteOptions {
  /** Who answers for Google: the global fetch, or a test's fake. No address in the kit can be configured. */
  fetch?: Fetch;
  now?: () => number;
}

export function createGoogleRoutes(auth: Auth, opts: GoogleRouteOptions = {}) {
  const fetch: Fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = opts.now ?? Date.now;
  const keys = createKeyCache({ fetch, now });
  /**
   * Each callback that gets as far as Google costs a call to Google's token
   * endpoint, and anyone can make one: fetch the start, follow it back. Ten a
   * minute per client is more than an owner signing in needs, and keeps this
   * server from being made to call Google without end (which Google would hold
   * against the app's own client).
   */
  const exchanges = createThrottle(10, 60_000, "sign-in attempts");
  /** Accounts let in by their address alone, each named in the log once (see the callback). */
  const byAddress = new Set<string>();

  const notSetUp = () => Response.json({ error: "Sign-in with Google is not set up" }, { status: 404 });

  /** GET /api/auth/google/start?return=<path> — leave for Google. */
  async function start(request: Request): Promise<Response> {
    const settings = auth.google().settings;
    const cookie = auth.GOOGLE_COOKIE;
    if (!settings || !cookie) return notSetUp();
    const key = await auth.flowKey();
    // No key to seal the state with means no key to sign a session with
    // (auth.ts says why in the log): there is no point sending anyone to Google.
    if (!key) return redirect(`${settings.origin}/login?signin=failed`, [clearCookie(cookie)]);
    const state = randomId();
    const nonce = randomId();
    const { verifier, challenge } = await pkcePair();
    const back = returnPath(new URL(request.url).searchParams.get("return"), settings.origin);
    const flow: Flow = { s: state, n: nonce, v: verifier, r: back, e: now() + FLOW_SECONDS * 1000 };
    const location = authorizeUrl({ clientId: settings.clientId, redirectUri: `${settings.origin}/api/auth/google/callback`, state, nonce, challenge });
    return redirect(location, [serializeCookie(cookie, await seal(flow, key, cookie), FLOW_SECONDS)]);
  }

  /** GET /api/auth/google/callback — Google sends the browser back here. */
  async function callback(request: Request): Promise<Response> {
    const settings = auth.google().settings;
    const cookie = auth.GOOGLE_COOKIE;
    const names = auth.GOOGLE_VARIABLES;
    if (!settings || !cookie || !names) return notSetUp();
    const failed = (reason: string | null) => {
      if (reason) console.warn(`[auth] Sign-in with Google refused: ${reason}.`);
      return redirect(`${settings.origin}/login?signin=failed`, [clearCookie(cookie)]);
    };
    try {
      const url = new URL(request.url);
      const key = await auth.flowKey();
      if (!key) return failed("there is no key to sign sessions with");
      const sealed = parseCookies(request.headers.get("cookie")).get(cookie);
      const flow = sealed ? await open(sealed, key, cookie, now()) : null;
      if (!flow) return failed("no sign-in under way in this browser, or it took longer than ten minutes");
      // The visitor said no at Google, or Google could not ask them: nothing to log.
      if (url.searchParams.has("error")) return failed(null);
      const state = url.searchParams.get("state");
      if (state === null || !(await safeEqual(state, flow.s))) return failed("state");
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096) return failed("code");
      if (exchanges.check(request, now())) return failed("too many sign-in attempts from one client in a minute");
      const redirectUri = `${settings.origin}/api/auth/google/callback`;
      const idToken = await exchangeCode({ fetch, clientId: settings.clientId, clientSecret: settings.clientSecret, redirectUri, code, verifier: flow.v });
      const identity = await verifyIdToken(idToken, { clientId: settings.clientId, nonce: flow.n, now: now(), keys });
      // The account id is Google's number for it, never its address: the owner
      // reads it here to add it to the list.
      if (!allowed(settings, identity)) return failed(`Google account ${identity.sub} is not on this app's list of who may sign in`);
      // An address on the list is only as good as Google's check of it, which for
      // an address outside gmail.com and outside a Google Workspace domain was made
      // once, when the account was created: a lapsed domain registered again, or
      // a recycled mailbox, can stand behind another account with the same verified
      // address. The account's id names this one alone, so the log offers it.
      if (!settings.subs.includes(identity.sub) && !byAddress.has(identity.sub)) {
        byAddress.add(identity.sub);
        console.warn(`[auth] Google account ${identity.sub} signed in by its address on ${names.allowedEmails}. To let in this account and no other with that address, add ${identity.sub} to ${names.allowedSubs} and take the address off.`);
      }
      const token = await auth.createToken(now());
      const secure = settings.origin.startsWith("https:") || cookieSecure(request);
      const session = `${auth.SESSION_COOKIE}=${token}; Path=/; Max-Age=${auth.SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
      return redirect(`${settings.origin}${flow.r}`, [session, clearCookie(cookie)]);
    } catch (error) {
      return failed(error instanceof AuthError ? error.reason : error instanceof Error ? error.name : "unknown");
    }
  }

  return { start, callback };
}
