import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authEnabled, cookieSecure, createToken, passwordMatches, resetSessionSeed, revokeToken, timingSafeEqual, verifyToken } from "@/lib/auth";
import { LOGIN_GLOBAL_MAX_ATTEMPTS, LOGIN_MAX_ATTEMPTS, loginBlocked, loginFailureDelay, recordLoginFailure, resetLimiters } from "@/lib/rate-limit";

let dataDir: string;
const previousDataDir = process.env.DATA_DIR;

beforeEach(() => {
  // The signing key is kept beside the data, so each test gets its own.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-auth-"));
  process.env.DATA_DIR = dataDir;
  resetSessionSeed();
});

afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.APP_SECRET;
  delete process.env.COOKIE_SECURE;
  delete process.env.TRUST_PROXY;
  delete process.env.TRUSTED_PROXY_HOPS;
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  resetSessionSeed();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("optional password gate", () => {
  it("is off unless a password is configured", () => {
    expect(authEnabled()).toBe(false);
    process.env.APP_PASSWORD = "hunter2";
    expect(authEnabled()).toBe(true);
  });

  it("accepts only the configured password", async () => {
    expect(await passwordMatches("anything")).toBe(false); // nothing configured
    process.env.APP_PASSWORD = "hunter2";
    expect(await passwordMatches("hunter2")).toBe(true);
    expect(await passwordMatches("hunter3")).toBe(false);
    expect(await passwordMatches("")).toBe(false);
    expect(await passwordMatches("hunter2 ")).toBe(false);
  });

  it("issues a token that verifies, expires, and resists tampering", async () => {
    process.env.APP_PASSWORD = "hunter2";
    const token = await createToken();
    expect(await verifyToken(token)).toBe(true);
    expect(await verifyToken(undefined)).toBe(false);
    expect(await verifyToken("garbage")).toBe(false);
    // a forged expiry does not match the signature
    const [, id, sig] = token.split(".");
    expect(await verifyToken(`${Date.now() + 9e9}.${id}.${sig}`)).toBe(false);
    // nor does a forged identity
    expect(await verifyToken(`${token.split(".")[0]}.0000.${sig}`)).toBe(false);
    // an expired token is refused even though the signature is genuine
    const old = await createToken(Date.now() - 40 * 86400_000);
    expect(await verifyToken(old)).toBe(false);
  });

  it.each([
    ["a key generated on first login", undefined],
    ["an APP_SECRET the operator set", "a-signing-secret-the-operator-chose"],
  ])("invalidates existing sessions when the password changes, with %s", async (_label, appSecret) => {
    // Both branches, because APP_SECRET used to be returned unmixed: the README
    // and this module's own comment promise that rotating the password ends
    // every session, and for anyone who set APP_SECRET it quietly did not.
    if (appSecret) process.env.APP_SECRET = appSecret;
    process.env.APP_PASSWORD = "hunter2";
    const token = await createToken();
    expect(await verifyToken(token)).toBe(true);
    process.env.APP_PASSWORD = "different";
    expect(await verifyToken(token)).toBe(false);
  });

  it("stops accepting a token once it has been signed out", async () => {
    // Clearing the cookie only ends the session in the browser holding it. A
    // copy taken off a shared machine or a plaintext hop kept working for the
    // rest of its thirty days, which is what sign-out is supposed to prevent.
    process.env.APP_PASSWORD = "hunter2";
    const stolen = await createToken();
    const other = await createToken();
    expect(await verifyToken(stolen)).toBe(true);

    expect(await revokeToken(stolen)).toBe("revoked");
    expect(await verifyToken(stolen)).toBe(false);
    // Only that session: signing out of one browser is not signing out of all.
    expect(await verifyToken(other)).toBe(true);

    // The proxy and the route handlers are separate bundles, so the list has to
    // be read back from disk rather than kept in one module's memory.
    resetSessionSeed();
    expect(await verifyToken(stolen)).toBe(false);
  });

  it("writes nothing down for a token that does not verify", async () => {
    // Signing out is reachable without a session, so anything else would let a
    // stranger grow the revocation file one made-up token at a time.
    process.env.APP_PASSWORD = "hunter2";
    const list = path.join(dataDir, "revoked-sessions");
    expect(await revokeToken(`${Date.now() + 9e9}.deadbeef.notasignature`)).toBe("no-session");
    expect(await revokeToken("garbage")).toBe("no-session");
    expect(await revokeToken(undefined)).toBe("no-session");
    expect(fs.existsSync(list)).toBe(false);

    // And a real sign-out is recorded once, however many times it is sent.
    const token = await createToken();
    expect(await revokeToken(token)).toBe("revoked");
    expect(await revokeToken(token)).toBe("no-session"); // it no longer verifies
    expect(fs.readFileSync(list, "utf8").trim().split("\n")).toHaveLength(1);
  });

  /**
   * Revocation is the whole point of the token id, and the README promises
   * signing out "ends that session for good". Every way of not knowing what has
   * been revoked used to answer "nothing has", which reinstated every cookie
   * their owner had already retired — and the owner was told the opposite at
   * the moment they acted.
   */
  describe("when the revocation list cannot be read or written", () => {
    const list = () => path.join(dataDir, "revoked-sessions");

    it("refuses the session rather than letting it back in", async () => {
      process.env.APP_PASSWORD = "hunter2";
      const stolen = await createToken();
      const other = await createToken();
      expect(await revokeToken(stolen)).toBe("revoked");

      // Unreadable (a directory in its place stands in for EACCES/EIO, which
      // arrive here the same way): nothing can be established about any token.
      fs.rmSync(list());
      fs.mkdirSync(list());
      resetSessionSeed();
      expect(await verifyToken(stolen)).toBe(false);
      expect(await verifyToken(other)).toBe(false);
    });

    it("refuses them when the list is deleted out from under a running app", async () => {
      process.env.APP_PASSWORD = "hunter2";
      const stolen = await createToken();
      expect(await revokeToken(stolen)).toBe("revoked");
      expect(await verifyToken(stolen)).toBe(false);
      // The file is only ever rewritten with its entries still in it, so its
      // disappearance is not "nothing was ever signed out".
      fs.rmSync(list());
      expect(await verifyToken(stolen)).toBe(false);
    });

    it("says signing out failed rather than reporting success", async () => {
      process.env.APP_PASSWORD = "hunter2";
      const token = await createToken();
      // A data directory that has gone read-only (EROFS here; a deleted volume
      // or a full disk arrives the same way). The write fails, and the caller
      // has to be told, because the cookie they are holding still works.
      const readOnly = () =>
        vi.spyOn(fs, "renameSync").mockImplementation(() => {
          throw Object.assign(new Error("EROFS: read-only file system, rename"), { code: "EROFS" });
        });

      let stop = readOnly();
      try {
        expect(await revokeToken(token)).toBe("failed");
      } finally {
        stop.mockRestore();
      }
      expect(fs.existsSync(list())).toBe(false);
      expect(await verifyToken(token)).toBe(true); // and it is honest about that
      // Nothing half-written is left where the list belongs.
      expect(fs.readdirSync(dataDir).filter((name) => name.startsWith("revoked-sessions"))).toEqual([]);

      const { DELETE } = await import("@/app/api/auth/route");
      stop = readOnly();
      let response: Response;
      try {
        response = await DELETE(new Request("http://localhost:3000/api/auth", { method: "DELETE", headers: { cookie: `cc_session=${token}` } }));
      } finally {
        stop.mockRestore();
      }
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("could not be retired") });
      // The browser's copy is still cleared: what failed is retiring the token.
      expect(response.headers.get("set-cookie")).toMatch(/cc_session=;/);
    });

    it("replaces the list in one step rather than truncating and rewriting it", async () => {
      process.env.APP_PASSWORD = "hunter2";
      expect(await revokeToken(await createToken())).toBe("revoked");

      const writes = vi.spyOn(fs, "writeFileSync");
      const renames = vi.spyOn(fs, "renameSync");
      try {
        expect(await revokeToken(await createToken())).toBe("revoked");
        const written = writes.mock.calls.map((call) => String(call[0]));
        // The list itself is never opened for writing. Truncate-then-write
        // leaves a reader a list with its tail missing if the process dies half
        // way through, and a missing tail is a forgotten revocation — a
        // stolen cookie back in service, which is the permissive direction.
        expect(written).not.toContain(list());
        expect(written.filter((file) => file.startsWith(list()))).toHaveLength(1);
        expect(renames.mock.calls.map((call) => String(call[1]))).toContain(list());
      } finally {
        writes.mockRestore();
        renames.mockRestore();
      }
      expect(fs.readFileSync(list(), "utf8").trim().split("\n")).toHaveLength(2);
      // And nothing is left lying about beside it.
      expect(fs.readdirSync(dataDir).filter((name) => name.startsWith("revoked-sessions."))).toEqual([]);
    });
  });

  it("gives every session its own identity", async () => {
    process.env.APP_PASSWORD = "hunter2";
    const [a, b] = [await createToken(), await createToken()];
    // Without one, two logins with the same expiry are literally the same
    // string, so there is nothing for sign-out to name.
    expect(a).not.toBe(b);
    expect(a.split(".")).toHaveLength(3);
  });

  it("signs with a stored random key rather than the password itself", async () => {
    process.env.APP_PASSWORD = "hunter2";
    const token = await createToken();
    const [expires, id, signature] = token.split(".");
    // Whoever steals the cookie holds the signed message; the signature must
    // not be something they can reproduce from a guess at the password.
    const enc = new TextEncoder();
    const derived = await crypto.subtle.importKey("raw", enc.encode("collectcollect:hunter2"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const guess = [...new Uint8Array(await crypto.subtle.sign("HMAC", derived, enc.encode(`${expires}.${id}`)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(signature).not.toBe(guess);

    // The key survives a restart: it is read back from the data directory.
    resetSessionSeed();
    expect(await verifyToken(token)).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "session-secret"))).toBe(true);

    // Another instance, with its own data directory, does not accept it.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-auth-other-"));
    process.env.DATA_DIR = other;
    resetSessionSeed();
    expect(await verifyToken(token)).toBe(false);
    fs.rmSync(other, { recursive: true, force: true });
  });

  it("compares strings without leaking through length", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("the Secure flag on the session cookie", () => {
  const request = (url: string, proto?: string) =>
    new Request(url, { method: "POST", headers: proto ? { "x-forwarded-proto": proto } : {} });

  it("follows the request scheme when nothing else says otherwise", () => {
    expect(cookieSecure(request("https://cards.example/api/auth"))).toBe(true);
    expect(cookieSecure(request("http://localhost:3000/api/auth"))).toBe(false);
  });

  it("believes X-Forwarded-Proto only when a proxy is declared, and only the hop that proxy wrote", () => {
    // TLS terminated by Caddy/nginx: the origin request arrives over plain HTTP.
    expect(cookieSecure(request("http://localhost:3000/api/auth", "https"))).toBe(false);
    process.env.TRUST_PROXY = "1";
    expect(cookieSecure(request("http://localhost:3000/api/auth", "https"))).toBe(true);
    expect(cookieSecure(request("http://localhost:3000/api/auth", "http"))).toBe(false);
    // A client can put anything in front of what the proxy appends, so the
    // entry believed is counted from the right — the same rule, and the same
    // code, as the login limiter's.
    expect(cookieSecure(request("http://localhost:3000/api/auth", "https, http"))).toBe(false);
    expect(cookieSecure(request("http://localhost:3000/api/auth", "http, https"))).toBe(true);
  });

  it("follows TRUSTED_PROXY_HOPS, which is the only thing some deployments set", () => {
    // .env.example offers TRUSTED_PROXY_HOPS for a two-proxy deployment. When
    // only the limiter honoured it, an operator who set it and nothing else got
    // a working limiter and a session cookie that quietly lost its Secure flag,
    // because this fell through to the plain-HTTP scheme of the origin request.
    delete process.env.TRUST_PROXY;
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(cookieSecure(request("http://localhost:3000/api/auth", "https, http"))).toBe(true);
    expect(cookieSecure(request("http://localhost:3000/api/auth", "http, http"))).toBe(false);
    // Still nothing to believe when the chain is shorter than the declared hops.
    expect(cookieSecure(request("http://localhost:3000/api/auth", "https"))).toBe(false);
  });

  it("can be forced either way", () => {
    process.env.COOKIE_SECURE = "1";
    expect(cookieSecure(request("http://localhost:3000/api/auth"))).toBe(true);
    process.env.COOKIE_SECURE = "0";
    expect(cookieSecure(request("https://cards.example/api/auth"))).toBe(false);
  });
});

describe("login redirect target", () => {
  it("only ever returns a path on this origin", async () => {
    const { safeNext } = await import("@/components/LoginForm");
    const origin = "https://cards.example";
    expect(safeNext("/collection?q=char", origin)).toBe("/collection?q=char");
    expect(safeNext("/", origin)).toBe("/");
    // Off-origin forms all fall back to the home page.
    expect(safeNext("//evil.example/steal", origin)).toBe("/");
    expect(safeNext("/\\evil.example", origin)).toBe("/");
    expect(safeNext("https://evil.example/steal", origin)).toBe("/");
    expect(safeNext("javascript:alert(1)", origin)).toBe("/");
    expect(safeNext("", origin)).toBe("/");
  });
});

/**
 * A counter that can refuse the right password is a weapon, not a defence: it
 * locks out whoever lands in the bucket someone else filled. Shared with every
 * caller (the default), that is eight anonymous wrong guesses to keep the owner
 * out of their own collection indefinitely; named through a forwarded header,
 * it is the owner's own address. So the password is compared first, and the
 * counters only ever decide what a *wrong* guess costs.
 */
describe("the login route", () => {
  beforeEach(() => {
    resetLimiters();
    process.env.APP_PASSWORD = "hunter2";
  });
  afterEach(() => resetLimiters());

  const post = async (password: unknown, forwarded?: string) => {
    const { POST } = await import("@/app/api/auth/route");
    return POST(
      new Request("http://localhost:3000/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json", ...(forwarded ? { "x-forwarded-for": forwarded } : {}) },
        body: JSON.stringify({ password }),
      }),
    );
  };

  /**
   * Post, recording what the route asked to wait rather than waiting it out.
   *
   * The delay is the throttle, so a test of it has to see it: the timer is
   * intercepted and fired at once, which means "returned without sleeping"
   * shows up as an empty list instead of as a test that merely runs quickly.
   */
  const charged = async (password: unknown, forwarded?: string): Promise<{ response: Response; waited: number[] }> => {
    const waited: number[] = [];
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, ms?: number) => {
      waited.push(ms ?? 0);
      if (typeof handler === "function") handler();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    try {
      return { response: await post(password, forwarded), waited };
    } finally {
      timer.mockRestore();
    }
  };

  it("lets the owner in however full the process-wide ceiling is", async () => {
    for (let i = 0; i < LOGIN_GLOBAL_MAX_ATTEMPTS; i++) recordLoginFailure(null);
    expect(loginBlocked(null)).toBe(true); // a wrong guess would be refused
    const response = await post("hunter2");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("cc_session=");
  });

  it("lets the owner in through a bucket filled from their own address", async () => {
    process.env.TRUST_PROXY = "1";
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordLoginFailure("203.0.113.5");
    expect((await charged("wrong", "203.0.113.5")).response.status).toBe(429);
    expect((await post("hunter2", "203.0.113.5")).status).toBe(200);
  });

  it("charges a wrong guess instead of refusing it when nobody can be told apart", async () => {
    // No proxy, so there is no per-caller bucket to fill and no per-caller
    // refusal to hand anyone; the cost is the throttle.
    const first = await charged("wrong");
    expect(first.response.status).toBe(401);
    expect(first.waited).toEqual([loginFailureDelay(1)]);
    expect((await post("hunter2")).status).toBe(200);
  });

  /**
   * A refusal on top of the cost is fine. A refusal *instead of* the cost is an
   * oracle: because the password is compared first, a blocked caller who guesses
   * right still gets 200, so if a wrong guess is free the pair of answers is a
   * password-guessing machine that runs as fast as the CPU allows — which is
   * precisely the regime an attacker is in, and the one the wall clock exists
   * for. Both buckets, because either can be the one that is full.
   */
  it("charges a blocked wrong guess the same wall clock as any other", async () => {
    process.env.TRUST_PROXY = "1";
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) recordLoginFailure("203.0.113.5");
    expect(loginBlocked("203.0.113.5")).toBe(true);

    const blocked = await charged("wrong", "203.0.113.5");
    expect(blocked.response.status).toBe(429);
    // Derived from the bucket, not from the constant the route uses: whatever a
    // ninth failure costs an unblocked caller is what this one paid.
    expect(blocked.waited).toEqual([loginFailureDelay(LOGIN_MAX_ATTEMPTS + 1)]);
    expect(blocked.waited[0]).toBeGreaterThan(0);
  });

  it("charges a wrong guess that hits the process-wide ceiling too", async () => {
    for (let i = 0; i < LOGIN_GLOBAL_MAX_ATTEMPTS; i++) recordLoginFailure(null);
    const blocked = await charged("wrong");
    expect(blocked.response.status).toBe(429);
    expect(blocked.waited).toEqual([loginFailureDelay(LOGIN_GLOBAL_MAX_ATTEMPTS + 1)]);
  });

  it("says so plainly when there is no password to check", async () => {
    delete process.env.APP_PASSWORD;
    expect((await post("anything")).status).toBe(400);
  });
});
