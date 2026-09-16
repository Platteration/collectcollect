import { NextResponse } from "next/server";
import { parseToken, type Auth } from "./auth";
import type { SessionStore } from "./sessions";
import { createThrottle } from "./throttle";
import { BodyLimitError, jsonError, readJsonLimited } from "./http";
import { isSecureRequest } from "./net";
import { clientKey } from "./throttle";

/**
 * The sign-in and sign-out handlers.
 *
 * Shared rather than copied: rate limiting a password form is the kind of thing
 * that is either right everywhere or quietly missing in one place. Each call
 * gets its own attempt counter, so two apps in one process would still be
 * limited separately.
 */
export function createAuthRoutes(auth: Auth, opts: { sessions?: SessionStore } = {}) {
  const { sessions } = opts;
  /** Ending every session is a deliberate act; six a minute is already five more than anyone means. */
  const revokeThrottle = createThrottle(6, 60_000, "sign-outs");

  /** Failed attempts per client, to slow down guessing. Resets when the process restarts. */
  const attempts = new Map<string, { count: number; until: number }>();
  const MAX_ATTEMPTS = 8;
  const LOCKOUT_MS = 60_000;
  /** More clients than this is not a household; it is someone sending headers. */
  const MAX_TRACKED = 10_000;

  /** Drop expired records, so the map only ever holds clients still being counted. */
  function prune(now: number) {
    for (const [key, record] of attempts) if (now >= record.until) attempts.delete(key);
  }

  async function POST(request: Request) {
    if (!auth.authEnabled()) return jsonError("This app has no password set", 400);

    const now = Date.now();
    prune(now);
    // The key comes from the connection unless TRUST_PROXY says a proxy set
    // X-Forwarded-For; otherwise anyone could reset their own counter with a
    // header, and every client is one client anyway.
    const key = clientKey(request);
    const record = attempts.get(key);
    if (record && record.count >= MAX_ATTEMPTS && now < record.until) {
      const response = jsonError("Too many attempts. Wait a minute and try again.", 429);
      response.headers.set("Retry-After", String(Math.ceil((record.until - now) / 1000)));
      return response;
    }

    // Reserve synchronously: parallel requests must count before password
    // verification yields. Never clear other clients to admit a new one.
    if (attempts.size >= MAX_TRACKED && !record) return jsonError("Too many sign-in attempts; try again later", 429);
    attempts.set(key, { count: (record?.count ?? 0) + 1, until: record?.until ?? now + LOCKOUT_MS });

    let body: { password?: unknown };
    try {
      body = await readJsonLimited(request, 4096);
    } catch (e) {
      if (e instanceof BodyLimitError) return jsonError(e.message, 413);
      return jsonError("Expected a JSON body");
    }

    if (!body || typeof body.password !== "string" || !(await auth.passwordMatches(body.password))) {
      return jsonError("Wrong password", 401);
    }

    attempts.delete(key);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(auth.SESSION_COOKIE, await auth.createToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      path: "/",
      maxAge: auth.SESSION_DAYS * 86400,
    });
    return response;
  }

  const clearCookie = (response: NextResponse) => {
    response.cookies.set(auth.SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  };

  /**
   * DELETE — sign out. The cookie is cleared, and the session it carried is
   * recorded as ended, so a copy of it somewhere else is no longer good either.
   */
  async function DELETE(request: Request) {
    const token = cookieValue(request, auth.SESSION_COOKIE);
    const presented = parseToken(token);
    if (presented && sessions && await auth.verifyToken(token)) sessions.revoke(presented.id, presented.expires);
    return clearCookie(NextResponse.json({ ok: true }));
  }

  /** POST /revoke — sign out everywhere: every session issued so far, this one included. */
  async function revokeAll(request: Request) {
    const refused = revokeThrottle.check(request);
    if (refused) return refused;
    if (!sessions) return jsonError("This app keeps no record of sessions, so they cannot be ended from here", 501);
    // The sign-in routes are reachable without a session, so this one checks
    // for itself: only someone signed in may sign everyone out.
    if (!(await auth.verifyToken(cookieValue(request, auth.SESSION_COOKIE), Date.now(), sessions.revoked()))) {
      return jsonError("Not signed in", 401);
    }
    sessions.revokeAll();
    return clearCookie(NextResponse.json({ ok: true }));
  }

  return { POST, DELETE, revokeAll };
}

/** One cookie out of a plain Request, which has no cookie jar of its own. */
function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}
