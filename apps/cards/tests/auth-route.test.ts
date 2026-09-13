import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "@collectcollect/core/auth";
import { createAuthRoutes } from "@collectcollect/core/auth-route";
import { createSessionStore } from "@collectcollect/core/sessions";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The sign-in handler, in isolation: its own auth instance and its own
 * attempt counter, so nothing here touches the app's real gate.
 */
const auth = createAuth({ cookie: "t_session", passwordEnv: "T_PASSWORD", secretEnv: "T_SECRET", secretPrefix: "t:" });

const attempt = (POST: (r: Request) => Promise<Response>, password: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/auth", { method: "POST", body: JSON.stringify({ password }), headers: { "Content-Type": "application/json", ...headers } }));

describe("signing in", () => {
  beforeEach(() => {
    process.env.T_PASSWORD = "hunter2";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.T_PASSWORD;
    delete process.env.TRUST_PROXY;
  });

  it("says so when there is no password to check against", async () => {
    delete process.env.T_PASSWORD;
    const { POST } = createAuthRoutes(auth);
    expect((await attempt(POST, "anything")).status).toBe(400);
  });

  it("refuses the wrong one, a missing one and a body that is not JSON", async () => {
    const { POST } = createAuthRoutes(auth);
    expect((await attempt(POST, "hunter3")).status).toBe(401);
    expect((await attempt(POST, 42)).status).toBe(401);
    expect((await POST(new Request("http://localhost/api/auth", { method: "POST", body: "{" }))).status).toBe(400);
  });

  it("sets a session cookie that is http-only and only marked secure over https", async () => {
    const { POST } = createAuthRoutes(auth);
    const plain = await attempt(POST, "hunter2");
    expect(plain.status).toBe(200);
    const cookie = plain.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^t_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/Secure/);
    const tls = await POST(new Request("https://cards.example/api/auth", { method: "POST", body: JSON.stringify({ password: "hunter2" }) }));
    expect(tls.headers.get("set-cookie")).toMatch(/Secure/);

    // Behind a proxy that terminates TLS the app sees plain http; the proxy
    // says otherwise, and is believed only when it is trusted.
    const behindProxy = () => attempt(POST, "hunter2", { "x-forwarded-proto": "https" });
    expect((await behindProxy()).headers.get("set-cookie")).not.toMatch(/Secure/);
    process.env.TRUST_PROXY = "1";
    try {
      expect((await behindProxy()).headers.get("set-cookie")).toMatch(/Secure/);
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });

  it("locks a client out after eight wrong guesses, for a minute", async () => {
    const { POST } = createAuthRoutes(auth);
    for (let i = 0; i < 8; i++) expect((await attempt(POST, "nope")).status).toBe(401);
    const locked = await attempt(POST, "hunter2");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("Retry-After"))).toBeGreaterThan(0);
    // The right password is refused too while the lockout holds...
    vi.advanceTimersByTime(30_000);
    expect((await attempt(POST, "hunter2")).status).toBe(429);
    // ...and works again once it has passed.
    vi.advanceTimersByTime(31_000);
    expect((await attempt(POST, "hunter2")).status).toBe(200);
  });

  it("cannot be reset with a forwarded-for header unless a proxy is trusted", async () => {
    const { POST } = createAuthRoutes(auth);
    for (let i = 0; i < 8; i++) await attempt(POST, "nope", { "x-forwarded-for": `10.0.0.${i}` });
    // Every one of those was the same client, whatever the header said.
    expect((await attempt(POST, "hunter2", { "x-forwarded-for": "10.0.0.99" })).status).toBe(429);

    process.env.TRUST_PROXY = "1";
    const trusted = createAuthRoutes(auth);
    for (let i = 0; i < 8; i++) await attempt(trusted.POST, "nope", { "x-forwarded-for": "203.0.113.1" });
    expect((await attempt(trusted.POST, "hunter2", { "x-forwarded-for": "203.0.113.1" })).status).toBe(429);
    // Behind a real proxy, a different client is a different client.
    expect((await attempt(trusted.POST, "hunter2", { "x-forwarded-for": "203.0.113.2" })).status).toBe(200);
  });

  it("signs out by clearing the cookie", async () => {
    const { DELETE } = createAuthRoutes(auth);
    const res = await DELETE(new Request("http://localhost/api/auth", { method: "DELETE" }));
    expect(res.headers.get("set-cookie")).toMatch(/^t_session=;.*Max-Age=0/i);
  });
});

describe("ending sessions", () => {
  let dir: string;
  beforeEach(() => {
    process.env.T_PASSWORD = "hunter2";
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-auth-sessions-"));
  });
  afterEach(() => {
    delete process.env.T_PASSWORD;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cookieOf = (res: Response) => /^t_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const withCookie = (url: string, method: string, token: string) => new Request(url, { method, headers: { cookie: `t_session=${token}` } });

  it("signing out ends that session and no other, and signing out everywhere ends them all", async () => {
    const sessions = createSessionStore(path.join(dir, "sessions.json"));
    const { POST, DELETE, revokeAll } = createAuthRoutes(auth, { sessions });
    const phone = cookieOf(await attempt(POST, "hunter2"));
    const laptop = cookieOf(await attempt(POST, "hunter2"));
    expect(phone).not.toBe(laptop);
    const good = (token: string) => auth.verifyToken(token, Date.now(), sessions.revoked());
    expect(await good(phone)).toBe(true);
    expect(await good(laptop)).toBe(true);

    // The phone signs out: its cookie is no longer honoured, even a copy of it.
    const out = await DELETE(withCookie("http://localhost/api/auth", "DELETE", phone));
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(await good(phone)).toBe(false);
    expect(await good(laptop)).toBe(true);

    // Signing out everywhere needs a session of its own to do it from…
    expect((await revokeAll(new Request("http://localhost/api/auth/revoke", { method: "POST" }))).status).toBe(401);
    expect((await revokeAll(withCookie("http://localhost/api/auth/revoke", "POST", phone))).status).toBe(401);
    // …and then ends every one, including the one that asked.
    const swept = await revokeAll(withCookie("http://localhost/api/auth/revoke", "POST", laptop));
    expect(swept.status).toBe(200);
    expect(swept.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(await good(laptop)).toBe(false);
    // A sign-in afterwards is fine.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10);
    const again = cookieOf(await attempt(POST, "hunter2"));
    vi.useRealTimers();
    expect(await good(again)).toBe(true);
  });

  it("says so when there is no record to end sessions in", async () => {
    const { POST, revokeAll } = createAuthRoutes(auth);
    const token = cookieOf(await attempt(POST, "hunter2"));
    const res = await revokeAll(withCookie("http://localhost/api/auth/revoke", "POST", token));
    expect(res.status).toBe(501);
  });
});
