import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import { createAuth } from "@collectcollect/core/auth";
import { createAuthRoutes } from "@collectcollect/core/auth-route";
import { googleOffer, googleVariables, readGoogle, returnPath } from "@collectcollect/core/google-config";
import { createSessionStore } from "@collectcollect/core/sessions";
import { authorize, createFakeGoogle, type FakeAccount } from "../../../scripts/fake-google.mjs";

/**
 * Sign-in with Google as a way past the gate, through the routes the app
 * mounts, against a fake Google (scripts/fake-google.mjs) handed in through
 * createAuthRoutes({ fetch }): its own RSA key, its own token endpoint, and a
 * consent screen that is a function. Nothing here can reach the network.
 */

const CLIENT = { id: "test-client.apps.googleusercontent.com", secret: "test-client-secret" };
const OWNER: FakeAccount = { sub: "1001", email: "owner@example.com", email_verified: true };
const COOKIE = "__Host-test-oauth";
/** A signing secret long enough to sign sessions with no password beside it (MIN_SECRET_BYTES). */
const SECRET = "a-signing-key-for-tests-at-least-32-bytes";
const ENV = ["G_APP_URL", "G_GOOGLE_CLIENT_ID", "G_GOOGLE_CLIENT_SECRET", "G_GOOGLE_ALLOWED_SUBS", "G_GOOGLE_ALLOWED_EMAILS", "G_PASSWORD", "G_SECRET"];

/** The routes' own gate, with no seed: the key is G_SECRET, or none. */
const auth = createAuth({
  cookie: "g_session",
  passwordEnv: "G_PASSWORD",
  secretEnv: "G_SECRET",
  secretPrefix: "g:",
  google: { variables: googleVariables("G_"), cookie: COOKIE },
});

function configure(over: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    G_APP_URL: "https://cards.example",
    G_GOOGLE_CLIENT_ID: CLIENT.id,
    G_GOOGLE_CLIENT_SECRET: CLIENT.secret,
    G_GOOGLE_ALLOWED_SUBS: "1001",
    G_SECRET: SECRET,
    ...over,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  for (const name of ENV) delete process.env[name];
  delete process.env.TRUST_PROXY;
});

const warned = () => warn.mock.calls.map((call) => String(call[0])).join("\n");
const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieValue = (res: Response, name: string) => {
  for (const line of setCookies(res)) if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).split(";")[0] ?? "";
  return null;
};

const encoder = new TextEncoder();
/** HMAC-SHA256, worked out here rather than by the code under test. */
async function hmac(key: string, message: string): Promise<Buffer> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", k, encoder.encode(message)));
}
/** A session token as auth.ts signs one, made by hand from a signing key and the message it is bound to. */
async function forge(signingKey: string, bound: unknown[]): Promise<string> {
  const key = (await hmac(signingKey, JSON.stringify(bound))).toString("hex");
  const now = Date.now();
  const body = `${now + 86_400_000}.${now}.${crypto.randomUUID()}`;
  return `v3.${body}.${(await hmac(key, body)).toString("hex")}`;
}
/** What a session is bound to with sign-in with Google, no password, and the list configure() writes. */
const GOOGLE_ALONE = ["session-v3", "g:", "", "google", ["1001"], []];

/** One sign-in, start to finish: the start route, Google's consent screen, and the callback with the cookie the start set. */
async function signIn(account: FakeAccount, opts: { back?: string; google?: Awaited<ReturnType<typeof createFakeGoogle>>; routes?: ReturnType<typeof createAuthRoutes>; tamper?: (callback: URL, flow: string) => { url: URL; flow: string } } = {}) {
  const google = opts.google ?? (await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret }));
  const routes = opts.routes ?? createAuthRoutes(auth, { fetch: google.fetch });
  const start = await routes.googleStart(new Request(`https://cards.example/api/auth/google/start${opts.back === undefined ? "" : `?return=${encodeURIComponent(opts.back)}`}`));
  const flow = cookieValue(start, COOKIE) ?? "";
  let url = new URL(authorize(start.headers.get("location") ?? "", account, { clientId: CLIENT.id }));
  let sent = flow;
  if (opts.tamper) ({ url, flow: sent } = opts.tamper(url, flow));
  const back = await routes.googleCallback(new Request(url, { headers: { cookie: `${COOKIE}=${sent}` } }));
  return { start, back, google, flow };
}

const failedTo = "https://cards.example/login?signin=failed";

describe("what the environment says", () => {
  const names = googleVariables("G_");

  it("is nothing at all until one of the app's GOOGLE_ variables is set", () => {
    expect(readGoogle(names, {})).toEqual({ touched: false, settings: null, warnings: [] });
    // APP_URL alone is an address, not a request for a gate.
    expect(readGoogle(names, { G_APP_URL: "https://cards.example" }).touched).toBe(false);
  });

  it("is on with everything in place, and holds the list sorted, lower-cased and without repeats", () => {
    const state = readGoogle(names, {
      G_APP_URL: "https://cards.example/",
      G_GOOGLE_CLIENT_ID: CLIENT.id,
      G_GOOGLE_CLIENT_SECRET: CLIENT.secret,
      G_GOOGLE_ALLOWED_SUBS: "2002, 1001 2002",
      G_GOOGLE_ALLOWED_EMAILS: "Owner@Example.com,owner@example.com",
    });
    expect(state.settings).toEqual({ origin: "https://cards.example", clientId: CLIENT.id, clientSecret: CLIENT.secret, subs: ["1001", "2002"], emails: ["owner@example.com"] });
    expect(state.warnings).toEqual([]);
  });

  it("is off, and says which variable is the trouble and never its value, when anything is missing or malformed", () => {
    const full = { G_APP_URL: "https://cards.example", G_GOOGLE_CLIENT_ID: CLIENT.id, G_GOOGLE_CLIENT_SECRET: CLIENT.secret, G_GOOGLE_ALLOWED_SUBS: "1001" };
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ G_GOOGLE_CLIENT_ID: "" }, /missing G_GOOGLE_CLIENT_ID/],
      [{ G_GOOGLE_CLIENT_ID: "not-a-google-client" }, /malformed G_GOOGLE_CLIENT_ID/],
      [{ G_GOOGLE_CLIENT_SECRET: "short" }, /malformed G_GOOGLE_CLIENT_SECRET/],
      [{ G_APP_URL: "" }, /missing G_APP_URL/],
      // Plain http to anywhere but this machine, a path (each app lives at the root of its origin), a query or credentials.
      [{ G_APP_URL: "http://cards.example" }, /malformed G_APP_URL/],
      [{ G_APP_URL: "https://example.com/cards/" }, /malformed G_APP_URL/],
      [{ G_APP_URL: "https://cards.example/?x=1" }, /malformed G_APP_URL/],
      [{ G_APP_URL: "https://user:pass@cards.example/" }, /malformed G_APP_URL/],
      // Nobody on the list would let in every Google account there is.
      [{ G_GOOGLE_ALLOWED_SUBS: "" }, /nobody may sign in: set G_GOOGLE_ALLOWED_SUBS or G_GOOGLE_ALLOWED_EMAILS/],
      [{ G_GOOGLE_ALLOWED_SUBS: "10/01", G_GOOGLE_ALLOWED_EMAILS: "not-an-address" }, /nobody may sign in/],
    ];
    for (const [over, why] of cases) {
      const state = readGoogle(names, { ...full, ...over });
      expect(state.touched, JSON.stringify(over)).toBe(true);
      expect(state.settings, JSON.stringify(over)).toBeNull();
      expect(state.warnings.join(" "), JSON.stringify(over)).toMatch(why);
      for (const value of Object.values(over)) if (value) expect(state.warnings.join(" ")).not.toContain(value);
      expect(state.warnings.join(" ")).not.toContain(CLIENT.secret);
    }
    // http on this machine is how the browser suites run it: a browser keeps a Secure cookie there.
    expect(readGoogle(names, { ...full, G_APP_URL: "http://127.0.0.1:3211" }).settings?.origin).toBe("http://127.0.0.1:3211");
    expect(readGoogle(names, { ...full, G_APP_URL: "http://localhost:3000/" }).settings?.origin).toBe("http://localhost:3000");
  });

  it("leaves out an entry of the list that cannot be one, and says so", () => {
    const state = readGoogle(names, { G_APP_URL: "https://cards.example", G_GOOGLE_CLIENT_ID: CLIENT.id, G_GOOGLE_CLIENT_SECRET: CLIENT.secret, G_GOOGLE_ALLOWED_SUBS: "1001,10/02,1003!", G_GOOGLE_ALLOWED_EMAILS: "nope" });
    expect(state.settings?.subs).toEqual(["1001"]);
    expect(state.settings?.emails).toEqual([]);
    expect(state.warnings.join(" ")).toMatch(/2 entries of G_GOOGLE_ALLOWED_SUBS that are not Google account ids were left out/);
    expect(state.warnings.join(" ")).toMatch(/1 entry of G_GOOGLE_ALLOWED_EMAILS that is not an address was left out/);
  });
});

describe("the gate, with sign-in with Google", () => {
  it("is on as soon as any one GOOGLE_ variable is set, even when the rest is missing, and then nobody gets in", async () => {
    // Each alone: an owner who set only the list, or only the secret, meant the
    // collection to be private, and a gate that stayed off would leave it open.
    const alone: Array<[string, string]> = [
      ["G_GOOGLE_CLIENT_ID", CLIENT.id],
      ["G_GOOGLE_CLIENT_SECRET", CLIENT.secret],
      ["G_GOOGLE_ALLOWED_SUBS", "1001"],
      ["G_GOOGLE_ALLOWED_EMAILS", "owner@example.com"],
    ];
    for (const [name, value] of alone) {
      for (const each of ENV) delete process.env[each];
      expect(auth.authEnabled(), name).toBe(false);
      process.env[name] = value;
      expect(auth.authEnabled(), name).toBe(true);
      expect(auth.passwordEnabled(), name).toBe(false);
      expect(auth.google().settings, name).toBeNull();
      // A token signed while the gate was off cannot exist; one made by hand is refused.
      process.env.G_SECRET = SECRET;
      const { googleStart, googleCallback, POST } = createAuthRoutes(auth);
      expect((await googleStart(new Request("https://cards.example/api/auth/google/start"))).status, name).toBe(404);
      expect((await googleCallback(new Request("https://cards.example/api/auth/google/callback?code=x&state=y"))).status, name).toBe(404);
      // There is no password to try either.
      expect((await POST(new Request("https://cards.example/api/auth", { method: "POST", body: JSON.stringify({ password: "" }), headers: { "Content-Type": "application/json" } }))).status, name).toBe(400);
    }
    expect(warned()).toMatch(/Sign-in with Google is off/);
  });

  it("signs a session for an account on the list, which the proxy then honours, and not a password session", async () => {
    configure();
    expect(auth.authEnabled()).toBe(true);
    const { back } = await signIn(OWNER, { back: "/collection?q=char" });
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("https://cards.example/collection?q=char");
    const token = cookieValue(back, "g_session");
    expect(await auth.verifyToken(token)).toBe(true);
    // The sign-in's own cookie is cleared on the way.
    expect(setCookies(back).find((c) => c.startsWith(`${COOKIE}=`))).toMatch(/Max-Age=0/);
  });

  it("lets an account in by a verified address on the list, and not by one Google has not verified", async () => {
    configure({ G_GOOGLE_ALLOWED_SUBS: undefined, G_GOOGLE_ALLOWED_EMAILS: "Owner@Example.com" });
    const ok = await signIn({ sub: "5005", email: "owner@example.com", email_verified: true });
    expect(ok.back.headers.get("location")).toBe("https://cards.example/");
    expect(await auth.verifyToken(cookieValue(ok.back, "g_session"))).toBe(true);
    // Google writes an address as its owner spelled it; the list is compared without case.
    process.env.G_GOOGLE_ALLOWED_EMAILS = "owner@example.com";
    const spelled = await signIn({ sub: "5005", email: "Owner@Example.COM", email_verified: true });
    expect(spelled.back.headers.get("location")).toBe("https://cards.example/");
    const unverified = await signIn({ sub: "5005", email: "owner@example.com", email_verified: false });
    expect(unverified.back.headers.get("location")).toBe(failedTo);
    expect(cookieValue(unverified.back, "g_session")).toBeNull();
  });

  it("names, once, the account id of one let in by its address alone, so the owner can pin it, and never the address", async () => {
    configure({ G_GOOGLE_ALLOWED_EMAILS: "friend@example.com" });
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const routes = createAuthRoutes(auth, { fetch: google.fetch });
    const byAddress = () => warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("by its address"));
    // Let in by its id, which names that account alone: nothing to say.
    expect((await signIn(OWNER, { google, routes })).back.headers.get("location")).toBe("https://cards.example/");
    expect(byAddress()).toEqual([]);
    const friend: FakeAccount = { sub: "7007", email: "friend@example.com", email_verified: true };
    for (let i = 0; i < 2; i++) expect((await signIn(friend, { google, routes })).back.headers.get("location")).toBe("https://cards.example/");
    expect(byAddress()).toEqual([
      "[auth] Google account 7007 signed in by its address on G_GOOGLE_ALLOWED_EMAILS. To let in this account and no other with that address, add 7007 to G_GOOGLE_ALLOWED_SUBS and take the address off.",
    ]);
    expect(warned()).not.toContain("friend@example.com");
  });

  it("refuses an account not on the list, and names Google's number for it in the log for the owner", async () => {
    configure();
    const { back } = await signIn({ sub: "6006", email: "stranger@example.com", email_verified: true });
    expect(back.headers.get("location")).toBe(failedTo);
    expect(cookieValue(back, "g_session")).toBeNull();
    expect(setCookies(back).find((c) => c.startsWith(`${COOKIE}=`))).toMatch(/Max-Age=0/);
    expect(warned()).toMatch(/Google account 6006 is not on this app's list/);
    expect(warned()).not.toContain("stranger@example.com");
  });

  it("ends every session, the password's included, when the list changes, as a new password does", async () => {
    configure({ G_PASSWORD: "hunter2" });
    const google = cookieValue((await signIn(OWNER)).back, "g_session");
    const password = await auth.createToken();
    expect(await auth.verifyToken(google)).toBe(true);
    expect(await auth.verifyToken(password)).toBe(true);
    process.env.G_GOOGLE_ALLOWED_SUBS = "1001,2002";
    expect(await auth.verifyToken(google)).toBe(false);
    expect(await auth.verifyToken(password)).toBe(false);
  });

  it("leaves a gate that offers no Google exactly as it was, so adding the option signs nobody out", async () => {
    process.env.G_PASSWORD = "hunter2";
    process.env.G_SECRET = "a-signing-key-for-tests";
    // What a session was signed with before sign-in with Google existed,
    // worked out here rather than by the code under test.
    const hmacHex = async (key: string, message: string) => {
      const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message))).toString("hex");
    };
    const secret = await hmacHex("a-signing-key-for-tests", JSON.stringify(["session-v3", "g:", "hunter2"]));
    const token = await auth.createToken();
    const [, expires, issued, id, signature] = token.split(".");
    expect(signature).toBe(await hmacHex(secret, `${expires}.${issued}.${id}`));
    const before = createAuth({ cookie: "g_session", passwordEnv: "G_PASSWORD", secretEnv: "G_SECRET", secretPrefix: "g:" });
    expect(await auth.verifyToken(await before.createToken())).toBe(true);
  });

  it("signs nobody in, and says so, when there is no key to sign a session with", async () => {
    configure({ G_SECRET: undefined });
    expect(auth.authEnabled()).toBe(true);
    const routes = createAuthRoutes(auth);
    const start = await routes.googleStart(new Request("https://cards.example/api/auth/google/start"));
    expect(start.headers.get("location")).toBe(failedTo);
    await expect(auth.createToken()).rejects.toThrow(/no key/);
    // A key derived from no password would be one anybody could compute: nothing verifies.
    const forged = await createAuth({ cookie: "g_session", passwordEnv: "G_PASSWORD", secretEnv: "G_SECRET", secretPrefix: "g:", seed: () => "g:" }).createToken().catch(() => null);
    expect(await auth.verifyToken(forged)).toBe(false);
    expect(warned()).toMatch(/Nobody can sign in: there is no key to sign sessions with.*G_SECRET/);
  });

  it("signs nobody in with no password and a secret shorter than 32 bytes, which a guess could find, and says so", async () => {
    const short = "s".repeat(31);
    configure({ G_SECRET: short });
    const start = await createAuthRoutes(auth).googleStart(new Request("https://cards.example/api/auth/google/start"));
    expect(start.headers.get("location")).toBe(failedTo);
    expect(cookieValue(start, COOKIE)).toBe("");
    await expect(auth.createToken()).rejects.toThrow(/no key/);
    // Whoever guessed it could sign a session by hand: none verifies.
    expect(await auth.verifyToken(await forge(short, GOOGLE_ALONE))).toBe(false);
    expect(warned()).toMatch(/Nobody can sign in: with no password, G_SECRET is the only secret a session is signed with, and it is shorter than 32 bytes/);
    expect(warned()).not.toContain(short);

    // 32 bytes is enough, counted as bytes: sixteen two-byte characters are 32.
    for (const enough of ["s".repeat(32), "é".repeat(16)]) {
      configure({ G_SECRET: enough });
      expect((await signIn(OWNER)).back.headers.get("location"), enough).toBe("https://cards.example/");
      // The same forgery, made with the right key, is one the gate takes: the check above refused it for its key alone.
      expect(await auth.verifyToken(await forge(enough, GOOGLE_ALONE)), enough).toBe(true);
    }
  });

  it("takes any secret beside a password, as it always did, since the password is signed into every session too", async () => {
    configure({ G_SECRET: "short", G_PASSWORD: "hunter2" });
    expect((await signIn(OWNER)).back.headers.get("location")).toBe("https://cards.example/");
    expect(await auth.verifyToken(await auth.createToken())).toBe(true);
  });

  it("marks the session cookie Secure for an https APP_URL, and not for this machine's plain http", async () => {
    configure();
    const https = await signIn(OWNER);
    expect(setCookies(https.back).find((c) => c.startsWith("g_session="))).toMatch(/; HttpOnly; SameSite=Lax; Secure$/);
    configure({ G_APP_URL: "http://127.0.0.1:3211" });
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const routes = createAuthRoutes(auth, { fetch: google.fetch });
    const start = await routes.googleStart(new Request("http://127.0.0.1:3211/api/auth/google/start"));
    const url = authorize(start.headers.get("location") ?? "", OWNER, { clientId: CLIENT.id });
    expect(url.startsWith("http://127.0.0.1:3211/api/auth/google/callback?")).toBe(true);
    const back = await routes.googleCallback(new Request(url, { headers: { cookie: `${COOKIE}=${cookieValue(start, COOKIE)}` } }));
    expect(back.headers.get("location")).toBe("http://127.0.0.1:3211/");
    expect(setCookies(back).find((c) => c.startsWith("g_session="))).not.toMatch(/Secure/);
  });

  it("ends a Google session like any other: signing out and signing out everywhere", async () => {
    configure();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-google-sessions-"));
    try {
      const sessions = createSessionStore(path.join(dir, "sessions.json"));
      const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
      const routes = createAuthRoutes(auth, { sessions, fetch: google.fetch });
      const good = (token: string | null) => auth.verifyToken(token, Date.now(), sessions.revoked());
      const phone = cookieValue((await signIn(OWNER, { google, routes })).back, "g_session");
      const laptop = cookieValue((await signIn(OWNER, { google, routes })).back, "g_session");
      expect(await good(phone)).toBe(true);
      await routes.DELETE(new Request("https://cards.example/api/auth", { method: "DELETE", headers: { cookie: `g_session=${phone}` } }));
      expect(await good(phone)).toBe(false);
      expect(await good(laptop)).toBe(true);
      expect((await routes.revokeAll(new Request("https://cards.example/api/auth/revoke", { method: "POST", headers: { cookie: `g_session=${laptop}` } }))).status).toBe(200);
      expect(await good(laptop)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("leaving for Google", () => {
  it("sends the browser to Google with the code flow, PKCE, a state and a nonce, and seals them in a __Host- cookie", async () => {
    configure();
    const start = await createAuthRoutes(auth).googleStart(new Request("https://cards.example/api/auth/google/start?return=%2Fcollection"));
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get("location") ?? "");
    expect(`${to.origin}${to.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = to.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(CLIENT.id);
    expect(p.get("redirect_uri")).toBe("https://cards.example/api/auth/google/callback");
    expect(p.get("scope")).toBe("openid email");
    expect(p.get("code_challenge_method")).toBe("S256");
    for (const name of ["state", "nonce", "code_challenge"]) expect(p.get(name)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = setCookies(start).find((c) => c.startsWith(`${COOKIE}=`)) ?? "";
    expect(cookie).toMatch(/; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookie).not.toMatch(/Domain=/i);
    // It is signed, not encrypted: what it carries is the visitor's own state,
    // nonce, PKCE verifier and return path, readable by whoever holds the
    // cookie, which no script on the page can (HttpOnly, above).
    const [payload] = (cookieValue(start, COOKIE) ?? "").split(".");
    const flow = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    expect(flow).toMatchObject({ s: p.get("state"), n: p.get("nonce"), r: "/collection" });
    // Nothing went to Google from the server yet.
    expect(warned()).toBe("");
  });

  it("goes back only to a page of this site, never another host and never the API", () => {
    const origin = "https://cards.example";
    expect(returnPath("/collection?q=char", origin)).toBe("/collection?q=char");
    expect(returnPath("/sets/./pokemon/../pokemon/Base%20Set", origin)).toBe("/sets/pokemon/Base%20Set");
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/",
      "%2F%2Fevil.example",
      "/%2F/evil.example",
      "/%5Cevil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/%09/evil.example",
      "javascript:alert(1)",
      "",
      "/api/backup",
      "/api/auth/google/start",
      `/${"a".repeat(1100)}`,
      "/%E0%A4%A",
      null,
      42,
    ]) {
      const target = returnPath(value, origin);
      expect(target, String(value)).toBe("/");
    }
    // Dot segments may resolve to a path that starts //; the origin is always written in front of it.
    const dotted = returnPath("/.//evil.example", origin);
    expect(new URL(`${origin}${dotted}`).origin).toBe(origin);
  });

  it("carries the return path through Google and back", async () => {
    configure();
    const { back } = await signIn(OWNER, { back: "//evil.example/steal" });
    expect(back.headers.get("location")).toBe("https://cards.example/");
  });
});

describe("the sign-in's own cookie", () => {
  /** The start route's cookie, which it hands to anyone who asks: its payload and its MAC. */
  async function startCookie() {
    const start = await createAuthRoutes(auth).googleStart(new Request("https://cards.example/api/auth/google/start"));
    const [payload = "", mac = ""] = (cookieValue(start, COOKIE) ?? "").split(".");
    expect(payload).not.toBe("");
    return { payload, mac };
  }

  it("is sealed with a key no session is signed with, so the start route, which answers anyone, is no way to guess one", async () => {
    // Google alone, sessions signed with the secret.
    configure();
    const underSecret = await startCookie();
    // A password and no seed and no secret: sessions are signed with a key made of the password.
    configure({ G_SECRET: undefined, G_PASSWORD: "hunter2" });
    const underPassword = await startCookie();
    for (const [what, { payload, mac }, key] of [["the secret", underSecret, SECRET], ["the password's key", underPassword, "g:hunter2"]] as const) {
      for (const message of [payload, `${COOKIE}.${payload}`]) expect((await hmac(key, message)).toString("base64url"), what).not.toBe(mac);
    }

    // Nor does the sign-in depend on that key at all: one started under one secret finishes under another.
    configure();
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const routes = createAuthRoutes(auth, { fetch: google.fetch });
    const start = await routes.googleStart(new Request("https://cards.example/api/auth/google/start"));
    const url = authorize(start.headers.get("location") ?? "", OWNER, { clientId: CLIENT.id });
    process.env.G_SECRET = `${SECRET}, and another one`;
    const back = await routes.googleCallback(new Request(url, { headers: { cookie: `${COOKIE}=${cookieValue(start, COOKIE)}` } }));
    expect(back.headers.get("location")).toBe("https://cards.example/");
    expect(await auth.verifyToken(cookieValue(back, "g_session"))).toBe(true);
  });

  it("is read only by the app that set it, under its own name", async () => {
    configure();
    const other = createAuth({ cookie: "o_session", passwordEnv: "G_PASSWORD", secretEnv: "G_SECRET", secretPrefix: "o:", google: { variables: googleVariables("G_"), cookie: "__Host-other-oauth" } });
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const start = await createAuthRoutes(auth, { fetch: google.fetch }).googleStart(new Request("https://cards.example/api/auth/google/start"));
    const url = authorize(start.headers.get("location") ?? "", OWNER, { clientId: CLIENT.id });
    const back = await createAuthRoutes(other, { fetch: google.fetch }).googleCallback(new Request(url, { headers: { cookie: `__Host-other-oauth=${cookieValue(start, COOKIE)}` } }));
    expect(back.headers.get("location")).toBe(failedTo);
    expect(cookieValue(back, "o_session")).toBeNull();
    expect(google.calls.token).toBe(0);
  });

  it("is not read once the process that sealed it has gone: that sign-in starts again", async () => {
    configure();
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const routes = createAuthRoutes(auth, { fetch: google.fetch });
    const start = await routes.googleStart(new Request("https://cards.example/api/auth/google/start"));
    const url = authorize(start.headers.get("location") ?? "", OWNER, { clientId: CLIENT.id });
    // A restart, as far as the key is concerned: the process's key is made anew.
    delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("collectcollect.google-sign-in.flow-key")];
    const back = await routes.googleCallback(new Request(url, { headers: { cookie: `${COOKIE}=${cookieValue(start, COOKIE)}` } }));
    expect(back.headers.get("location")).toBe(failedTo);
    expect(google.calls.token).toBe(0);
    // And the next one goes through.
    expect((await signIn(OWNER, { google, routes })).back.headers.get("location")).toBe("https://cards.example/");
  });
});

describe("coming back from Google", () => {
  beforeEach(() => configure());

  it("refuses a missing, tampered or stale sign-in cookie, a state that differs and a refusal at Google, without calling Google", async () => {
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const routes = createAuthRoutes(auth, { fetch: google.fetch });
    const cases: Array<[string, (url: URL, flow: string) => { url: URL; flow: string }]> = [
      ["no cookie", (url) => ({ url, flow: "" })],
      ["another cookie's MAC", (url, flow) => ({ url, flow: `${flow.split(".")[0]}.${"A".repeat(43)}` })],
      ["an edited payload", (url, flow) => ({ url, flow: `${flow.split(".")[0]}x.${flow.split(".")[1]}` })],
      ["a state that differs", (url, flow) => { url.searchParams.set("state", "x".repeat(43)); return { url, flow }; }],
      ["no state", (url, flow) => { url.searchParams.delete("state"); return { url, flow }; }],
      ["Google said no", (url, flow) => { url.searchParams.set("error", "access_denied"); return { url, flow }; }],
      ["no code", (url, flow) => { url.searchParams.delete("code"); return { url, flow }; }],
    ];
    for (const [what, tamper] of cases) {
      const { back } = await signIn(OWNER, { google, routes, tamper });
      expect(back.headers.get("location"), what).toBe(failedTo);
      expect(cookieValue(back, "g_session"), what).toBeNull();
      expect(setCookies(back).find((c) => c.startsWith(`${COOKIE}=`)), what).toMatch(/Max-Age=0/);
    }
    expect(google.calls.token).toBe(0);
  });

  it("sends Google no code longer than 4096 characters", async () => {
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const routes = createAuthRoutes(auth, { fetch: google.fetch });
    const withCode = (code: string) => (url: URL, flow: string) => {
      url.searchParams.set("code", code);
      return { url, flow };
    };
    const long = await signIn(OWNER, { google, routes, tamper: withCode("c".repeat(4097)) });
    expect(long.back.headers.get("location")).toBe(failedTo);
    expect(google.calls.token).toBe(0);
    expect(warned()).toContain("refused: code.");
    // One character fewer is Google's to answer (and this one it refuses).
    const longest = await signIn(OWNER, { google, routes, tamper: withCode("c".repeat(4096)) });
    expect(longest.back.headers.get("location")).toBe(failedTo);
    expect(google.calls.token).toBe(1);
  });

  it("refuses a sign-in cookie older than ten minutes", async () => {
    let clock = Date.parse("2026-10-13T12:00:00Z");
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret, now: () => clock });
    const routes = createAuthRoutes(auth, { fetch: google.fetch, now: () => clock });
    const start = await routes.googleStart(new Request("https://cards.example/api/auth/google/start"));
    const url = authorize(start.headers.get("location") ?? "", OWNER, { clientId: CLIENT.id });
    clock += 600_001;
    const back = await routes.googleCallback(new Request(url, { headers: { cookie: `${COOKIE}=${cookieValue(start, COOKIE)}` } }));
    expect(back.headers.get("location")).toBe(failedTo);
    expect(google.calls.token).toBe(0);
  });

  it("refuses an ID token for another nonce, another client, another issuer, or with no signature to check", async () => {
    for (const [what, account] of [
      ["nonce", { ...OWNER, claims: { nonce: "another" } }],
      ["aud", { ...OWNER, claims: { aud: "other.apps.googleusercontent.com" } }],
      ["iss", { ...OWNER, claims: { iss: "https://evil.example" } }],
      ["alg", { ...OWNER, header: { alg: "none" } }],
      ["exp", { ...OWNER, claims: { exp: 1 } }],
    ] as Array<[string, FakeAccount]>) {
      const { back } = await signIn(account);
      expect(back.headers.get("location"), what).toBe(failedTo);
      expect(cookieValue(back, "g_session"), what).toBeNull();
      expect(warned(), what).toContain(`refused: ${what}.`);
    }
  });

  it("refuses a code Google will not exchange, and a code sent back twice", async () => {
    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: "another-secret-entirely" });
    const { back } = await signIn(OWNER, { google });
    expect(back.headers.get("location")).toBe(failedTo);
    expect(warned()).toContain("refused: token.");

    const honest = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const routes = createAuthRoutes(auth, { fetch: honest.fetch });
    const start = await routes.googleStart(new Request("https://cards.example/api/auth/google/start"));
    const url = authorize(start.headers.get("location") ?? "", OWNER, { clientId: CLIENT.id });
    const cookie = { cookie: `${COOKIE}=${cookieValue(start, COOKIE)}` };
    expect((await routes.googleCallback(new Request(url, { headers: cookie }))).headers.get("location")).toBe("https://cards.example/");
    expect((await routes.googleCallback(new Request(url, { headers: cookie }))).headers.get("location")).toBe(failedTo);
  });

  it("calls Google at most ten times a minute for one client", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
    try {
      const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
      const routes = createAuthRoutes(auth, { fetch: google.fetch });
      for (let i = 0; i < 10; i++) expect((await signIn(OWNER, { google, routes })).back.headers.get("location")).toBe("https://cards.example/");
      const eleventh = await signIn(OWNER, { google, routes });
      expect(eleventh.back.headers.get("location")).toBe(failedTo);
      expect(google.calls.token).toBe(10);
      vi.advanceTimersByTime(61_000);
      expect((await signIn(OWNER, { google, routes })).back.headers.get("location")).toBe("https://cards.example/");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the login page's offer", () => {
  it("is a link to start at APP_URL, a note when the setup is broken, or nothing", () => {
    configure();
    expect(googleOffer(auth.google(), "/collection")).toEqual({ kind: "ready", href: "https://cards.example/api/auth/google/start?return=%2Fcollection" });
    expect(googleOffer(auth.google(), "https://evil.example/")).toEqual({ kind: "ready", href: "https://cards.example/api/auth/google/start?return=%2F" });
    process.env.G_GOOGLE_ALLOWED_SUBS = "";
    expect(googleOffer(auth.google(), "/")).toEqual({ kind: "broken" });
    for (const name of ENV) delete process.env[name];
    expect(googleOffer(auth.google(), "/")).toBeNull();
  });
});

describe("this app's own variables", () => {
  const names = ["APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ALLOWED_SUBS", "GOOGLE_ALLOWED_EMAILS", "SKINS_GOOGLE_CLIENT_ID", "SKINS_GOOGLE_ALLOWED_SUBS"];
  afterEach(() => {
    for (const name of names) delete process.env[name];
  });

  it("are APP_URL and GOOGLE_*, never the skins app's, and the gate and the proxy follow them", async () => {
    const { auth: cards } = await import("@/lib/auth");
    const { proxy } = await import("@/proxy");
    process.env.SKINS_GOOGLE_CLIENT_ID = CLIENT.id;
    process.env.SKINS_GOOGLE_ALLOWED_SUBS = "1001";
    expect(cards.authEnabled()).toBe(false);
    process.env.APP_URL = "http://localhost:3000";
    process.env.GOOGLE_CLIENT_ID = CLIENT.id;
    process.env.GOOGLE_CLIENT_SECRET = CLIENT.secret;
    process.env.GOOGLE_ALLOWED_SUBS = "1001";
    expect(cards.authEnabled()).toBe(true);
    expect(cards.google().settings?.origin).toBe("http://localhost:3000");
    expect(cards.GOOGLE_COOKIE).toBe("__Host-collectcollect-cards-oauth");
    // With Google alone, every page needs a session, and the way in does not.
    const page = await proxy(new NextRequest("http://localhost:3000/collection", { headers: { host: "localhost:3000" } }));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fcollection");
    for (const path of ["/api/auth/google/start", "/api/auth/google/callback"]) {
      const res = await proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000" } }));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
    expect((await proxy(new NextRequest("http://localhost:3000/api/cards", { headers: { host: "localhost:3000" } }))).status).toBe(401);
  });
});
