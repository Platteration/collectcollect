/**
 * Sign in with Google, as a way past an app's gate beside the password or in
 * its place: what the environment says about it, read the way the password is,
 * when asked rather than at start.
 *
 * Each app has variables of its own, as it has its own password (auth.ts): the
 * card app reads APP_URL and GOOGLE_*, the skins app SKINS_APP_URL and
 * SKINS_GOOGLE_*. One Google client may serve both, with both callback
 * addresses on it; who may sign in is still each app's own list.
 *
 * Free of the framework and of node:, like auth.ts: the proxy reads it on
 * every request.
 */

/** The names of one app's variables. */
export interface GoogleVariables {
  /** The address of the site's root, which Google sends the browser back to. */
  appUrl: string;
  clientId: string;
  clientSecret: string;
  /** Google account ids (`sub`) that may sign in. */
  allowedSubs: string;
  /** Addresses that may sign in, when Google says the account's address is verified. */
  allowedEmails: string;
}

/** The variables an app reads, by prefix: "" for the card app, "SKINS_" for the skins app. */
export function googleVariables(prefix: string): GoogleVariables {
  return {
    appUrl: `${prefix}APP_URL`,
    clientId: `${prefix}GOOGLE_CLIENT_ID`,
    clientSecret: `${prefix}GOOGLE_CLIENT_SECRET`,
    allowedSubs: `${prefix}GOOGLE_ALLOWED_SUBS`,
    allowedEmails: `${prefix}GOOGLE_ALLOWED_EMAILS`,
  };
}

/** A configuration that holds: everything sign-in needs, and someone allowed to use it. */
export interface GoogleSettings {
  /** The site's origin, from APP_URL: every address the sign-in writes starts with it. */
  origin: string;
  clientId: string;
  clientSecret: string;
  /** Sorted and without repeats, so the order they were written in changes nothing. */
  subs: readonly string[];
  /** Lower case, sorted and without repeats. */
  emails: readonly string[];
}

export interface GoogleState {
  /**
   * One of this app's GOOGLE_ variables is set. The gate is then on whether or
   * not the rest holds: an owner who set up Google sign-in and missed a value
   * meant the collection to be private, and a gate that opened over the
   * mistake would make it public.
   */
  touched: boolean;
  /** Everything holds, and sign-in with Google is offered. */
  settings: GoogleSettings | null;
  /** What is missing, malformed or left out, by variable name and never by value. */
  warnings: string[];
}

/** Google's `sub`, as the kit reads one (kit/google.js). */
const SUBJECT = /^[A-Za-z0-9_-]{1,255}$/;
/** An address as the kit keeps one (kit/google.js): it only ever compares this. */
const EMAIL = /^[^\s@\p{Cc}]{1,64}@[^\s@\p{Cc}]{1,255}$/u;
const CLIENT_ID = /^[0-9A-Za-z_.-]{1,200}\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET = /^[\x21-\x7e]{10,200}$/;

/**
 * APP_URL as an origin, or null. The site's root only (each app lives at the
 * root of its own origin), https, or http for this machine alone, where a
 * browser still keeps the sign-in's Secure cookie; with or without the
 * trailing slash, and nothing else: no path, query, fragment or credentials.
 */
function parseAppUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password || text.includes("?") || text.includes("#")) return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

/** A comma- or space-separated list, each entry kept when `keep` says so; how many were not. */
function list(value: string, keep: (entry: string) => boolean): { kept: string[]; dropped: number } {
  const entries = value.split(/[\s,]+/).filter(Boolean);
  const kept = entries.filter(keep);
  return { kept: [...new Set(kept)].sort(), dropped: entries.length - kept.length };
}

/** Read one app's Google configuration from the environment. */
export function readGoogle(names: GoogleVariables, env: Record<string, string | undefined> = process.env): GoogleState {
  const raw = (name: string) => {
    const value = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined;
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  const touched = [names.clientId, names.clientSecret, names.allowedSubs, names.allowedEmails].some((name) => raw(name) !== undefined);
  if (!touched) return { touched: false, settings: null, warnings: [] };

  const problems: string[] = [];
  const notes: string[] = [];
  const read = <T>(name: string, parse: (value: string) => T | null): T | null => {
    const value = raw(name);
    if (value === undefined) {
      problems.push(`missing ${name}`);
      return null;
    }
    const parsed = parse(value);
    if (parsed === null) problems.push(`malformed ${name}`);
    return parsed;
  };
  const origin = read(names.appUrl, parseAppUrl);
  const clientId = read(names.clientId, (v) => (CLIENT_ID.test(v) ? v : null));
  const clientSecret = read(names.clientSecret, (v) => (CLIENT_SECRET.test(v) ? v : null));
  const subs = list(raw(names.allowedSubs) ?? "", (entry) => SUBJECT.test(entry));
  const emails = list((raw(names.allowedEmails) ?? "").toLowerCase(), (entry) => EMAIL.test(entry));
  if (subs.dropped) notes.push(`${subs.dropped} entr${subs.dropped === 1 ? "y" : "ies"} of ${names.allowedSubs} that ${subs.dropped === 1 ? "is not a Google account id was" : "are not Google account ids were"} left out`);
  if (emails.dropped) notes.push(`${emails.dropped} entr${emails.dropped === 1 ? "y" : "ies"} of ${names.allowedEmails} that ${emails.dropped === 1 ? "is not an address was" : "are not addresses were"} left out`);
  // Without a list, every Google account in the world could sign in: off, not open.
  if (subs.kept.length === 0 && emails.kept.length === 0) problems.push(`nobody may sign in: set ${names.allowedSubs} or ${names.allowedEmails}`);

  const warnings: string[] = [];
  if (problems.length > 0) warnings.push(`Sign-in with Google is off, and nobody can sign in through it (${problems.join("; ")}).`);
  if (notes.length > 0) warnings.push(`Sign-in with Google: ${notes.join("; ")}.`);
  const settings = origin && clientId && clientSecret && problems.length === 0 ? { origin, clientId, clientSecret, subs: subs.kept, emails: emails.kept } : null;
  return { touched, settings, warnings };
}

/**
 * What a session token is bound to besides the password: who may sign in with
 * Google. Changing the list ends every session, as changing the password does,
 * so an account taken off it is signed out wherever it was signed in.
 */
export function googleBinding(settings: GoogleSettings): unknown[] {
  return ["google", settings.subs, settings.emails];
}

/** Whether the account Google vouched for is one this app lets in. */
export function allowed(settings: GoogleSettings, identity: { sub: string; email?: string }): boolean {
  if (settings.subs.includes(identity.sub)) return true;
  return identity.email !== undefined && settings.emails.includes(identity.email.toLowerCase());
}

/**
 * One leading slash, no backslash, no control character: the URL parser drops
 * tabs and newlines, so `/\t/evil.example` would otherwise read as `//evil.example`.
 */
function plainPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** How long a return path may be: it travels in the sign-in cookie, which a browser drops past 4 KB. */
const MAX_RETURN = 1024;

/**
 * Where to send the browser once it is signed in: a page of this site, or the
 * home page. The kit's rule (kit/app.js, safeReturnPath) at the site's root:
 * once decoded, one leading slash, no backslash and no control character (and
 * so as given too: decoding only adds characters a check here refuses), and
 * nothing under /api/. The caller puts the site's origin in front of what this
 * returns, so it is never read as another host.
 */
export function returnPath(value: unknown, origin: string): string {
  if (typeof value !== "string") return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/";
  }
  if (!plainPath(decoded)) return "/";
  let target: URL;
  try {
    target = new URL(value, origin);
  } catch {
    return "/";
  }
  if (target.pathname.startsWith("/api/")) return "/";
  const path = `${target.pathname}${target.search}`;
  return path.length > MAX_RETURN ? "/" : path;
}

/** What the login page offers for Google: a link to start, a note that it is not set up, or nothing. */
export type GoogleOffer = { kind: "ready"; href: string } | { kind: "broken" } | null;

/**
 * The login page's Google button. The link is absolute, to APP_URL: the
 * sign-in cookie it sets is for that name alone, so one started from a home
 * network's name finishes on the address Google returns to.
 */
export function googleOffer(state: GoogleState, next: string): GoogleOffer {
  if (state.settings) {
    const back = returnPath(next, state.settings.origin);
    return { kind: "ready", href: `${state.settings.origin}/api/auth/google/start?return=${encodeURIComponent(back)}` };
  }
  return state.touched ? { kind: "broken" } : null;
}
