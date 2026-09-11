import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, authEnabled, cookieSecure, createToken, passwordMatches, revokeToken } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { clearLoginFailures, clientKey, loginBlocked, loginFailureDelay, recordLoginFailure } from "@/lib/rate-limit";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  if (!authEnabled()) return jsonError("This app has no password set", 400);

  // Null when no trusted proxy names the caller, in which case there is no
  // per-caller bucket to fill; see clientKey.
  const key = clientKey(request);

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return jsonError("Expected a JSON body");
  }

  // The password is compared before any counter is consulted, so no counter can
  // ever refuse the right one. A lockout that can is a weapon: whoever fills the
  // bucket the owner lands in — a shared one, or a key they named themselves —
  // locks the owner out of their own collection, and only a correct login
  // clears it. Comparing first costs two HMACs, which is nothing to spend.
  if (typeof body.password !== "string" || !(await passwordMatches(body.password))) {
    const failures = recordLoginFailure(key);
    const blocked = loginBlocked(key);
    // The wall clock is charged first and charged always. Returning the 429
    // ahead of the sleep made the throttle vanish exactly when the caller was
    // over budget: a wrong guess became free, while the right password still
    // answered 200 — a counter that told an attacker which guess was correct
    // and cost them nothing to ask. A refusal on top of the cost is fine; a
    // refusal *instead of* the cost is an oracle.
    await sleep(loginFailureDelay(failures));
    return blocked
      ? jsonError("Too many failed attempts. Try again later.", 429)
      : jsonError("Wrong password", 401);
  }

  clearLoginFailures(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(request),
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return response;
}

/** DELETE — sign out. */
export async function DELETE(request: Request) {
  // Clearing the cookie only ends the session in this browser. A copy taken off
  // a shared machine or a plaintext hop keeps working for the rest of its thirty
  // days unless the token itself is retired, which is what signing out is for.
  const outcome = await revokeToken(readSessionCookie(request));
  // Say so when it could not be recorded. Answering ok:true to a revocation
  // that was never written tells the owner the stolen copy is dead at the one
  // moment they are acting on the belief that it is.
  const response =
    outcome === "failed"
      ? jsonError(
          "Signed out in this browser, but this session could not be retired on the server, so a copy of the cookie still works. Change APP_PASSWORD to end every session.",
          500,
        )
      : NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

/** The session cookie's value, without pulling in the whole cookie machinery. */
function readSessionCookie(request: Request): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === SESSION_COOKIE) return part.slice(at + 1).trim();
  }
  return undefined;
}
