import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authEnabled, cookieSecure, createToken, passwordMatches, resetSessionSeed, timingSafeEqual, verifyToken } from "@/lib/auth";

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
    const [, sig] = token.split(".");
    expect(await verifyToken(`${Date.now() + 9e9}.${sig}`)).toBe(false);
    // an expired token is refused even though the signature is genuine
    const old = await createToken(Date.now() - 40 * 86400_000);
    expect(await verifyToken(old)).toBe(false);
  });

  it("invalidates existing sessions when the password changes", async () => {
    process.env.APP_PASSWORD = "hunter2";
    const token = await createToken();
    process.env.APP_PASSWORD = "different";
    expect(await verifyToken(token)).toBe(false);
  });

  it("signs with a stored random key rather than the password itself", async () => {
    process.env.APP_PASSWORD = "hunter2";
    const token = await createToken();
    const [expires, signature] = token.split(".");
    // Whoever steals the cookie holds the signed message; the signature must
    // not be something they can reproduce from a guess at the password.
    const enc = new TextEncoder();
    const derived = await crypto.subtle.importKey("raw", enc.encode("collectcollect:hunter2"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const guess = [...new Uint8Array(await crypto.subtle.sign("HMAC", derived, enc.encode(expires)))]
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

  it("believes X-Forwarded-Proto only when a proxy is declared", () => {
    // TLS terminated by Caddy/nginx: the origin request arrives over plain HTTP.
    expect(cookieSecure(request("http://localhost:3000/api/auth", "https"))).toBe(false);
    process.env.TRUST_PROXY = "1";
    expect(cookieSecure(request("http://localhost:3000/api/auth", "https, http"))).toBe(true);
    expect(cookieSecure(request("http://localhost:3000/api/auth", "http"))).toBe(false);
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
