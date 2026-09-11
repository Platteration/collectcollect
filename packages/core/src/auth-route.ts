import { NextResponse } from "next/server";
import type { Auth } from "./auth";
import { jsonError } from "./http";
import { clientKey } from "./throttle";

/**
 * The sign-in and sign-out handlers.
 *
 * Shared rather than copied: rate limiting a password form is the kind of thing
 * that is either right everywhere or quietly missing in one place. Each call
 * gets its own attempt counter, so two apps in one process would still be
 * limited separately.
 */
export function createAuthRoutes(auth: Auth) {
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

    let body: { password?: unknown };
    try {
      body = (await request.json()) as { password?: unknown };
    } catch {
      return jsonError("Expected a JSON body");
    }

    if (typeof body.password !== "string" || !(await auth.passwordMatches(body.password))) {
      const next = record && now < record.until ? record.count + 1 : 1;
      if (attempts.size >= MAX_TRACKED && !attempts.has(key)) attempts.clear();
      attempts.set(key, { count: next, until: now + LOCKOUT_MS });
      return jsonError("Wrong password", 401);
    }

    attempts.delete(key);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(auth.SESSION_COOKIE, await auth.createToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.url.startsWith("https://"),
      path: "/",
      maxAge: auth.SESSION_DAYS * 86400,
    });
    return response;
  }

  /** DELETE — sign out. */
  async function DELETE() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(auth.SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }

  return { POST, DELETE };
}
