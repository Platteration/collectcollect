import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, authEnabled, cookieSecure, createToken, passwordMatches } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { LOGIN_FAILURE_DELAY_MS, clearLoginFailures, clientKey, loginBlocked, recordLoginFailure } from "@/lib/rate-limit";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  if (!authEnabled()) return jsonError("This app has no password set", 400);

  const key = clientKey(request);
  if (loginBlocked(key)) {
    return jsonError("Too many failed attempts. Try again later.", 429);
  }

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return jsonError("Expected a JSON body");
  }

  if (typeof body.password !== "string" || !(await passwordMatches(body.password))) {
    recordLoginFailure(key);
    // Every wrong guess costs wall clock, which is the only cost an attacker
    // rotating request headers cannot shed.
    await sleep(LOGIN_FAILURE_DELAY_MS);
    return jsonError("Wrong password", 401);
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
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
