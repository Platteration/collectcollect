import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authEnabled, createToken, passwordMatches, timingSafeEqual, verifyToken } from "@/lib/auth";
import { createAuth, tokenId } from "@collectcollect/core/auth";
import { createSessionSeed } from "@collectcollect/core/session-seed";
import { dataDir } from "@/lib/paths";

afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.APP_SECRET;
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
    const [v, , issued, id, sig] = token.split(".");
    expect(await verifyToken(`${v}.${Date.now() + 9e9}.${issued}.${id}.${sig}`)).toBe(false);
    // and a token from before sessions carried an id is no longer honoured
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

  it("carries an id, and is refused once its session has been ended", async () => {
    process.env.APP_PASSWORD = "hunter2";
    const now = Date.now();
    const token = await createToken(now);
    expect(token).toMatch(/^v3\.\d+\.\d+\.[a-f0-9-]{36}\.[a-f0-9]{64}$/);
    const id = tokenId(token);
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(tokenId("garbage")).toBeNull();
    // Nothing revoked: good. Everything before a later moment: gone. Named: gone.
    expect(await verifyToken(token, now + 1000, { before: 0, ids: [] })).toBe(true);
    expect(await verifyToken(token, now + 1000, { before: now + 1, ids: [] })).toBe(false);
    expect(await verifyToken(token, now + 1000, { before: 0, ids: [id!] })).toBe(false);
    // A session made after the sweep is not caught by it.
    const later = await createToken(now + 5000);
    expect(await verifyToken(later, now + 6000, { before: now + 1, ids: [id!] })).toBe(true);
  });

  it("compares strings without leaking through length", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("the signing key", () => {
  const seedFile = () => path.join(dataDir(), "session-secret");
  const like = (seed: () => string | null) =>
    createAuth({ cookie: "cc_session", passwordEnv: "APP_PASSWORD", secretEnv: "APP_SECRET", secretPrefix: "collectcollect:", seed });

  it("is a random key kept beside the collection, made on first use and readable by nobody else", async () => {
    process.env.APP_PASSWORD = "hunter2";
    expect(fs.existsSync(seedFile())).toBe(false);
    const token = await createToken();
    expect(fs.readFileSync(seedFile(), "utf8").trim()).toMatch(/^[a-f0-9]{64}$/);
    if (process.platform !== "win32") expect(fs.statSync(seedFile()).mode & 0o777).toBe(0o600);
    expect(await verifyToken(token)).toBe(true);
    // The key, not the password, is what signs: a different key refuses the token.
    fs.writeFileSync(seedFile(), `${"a".repeat(48)}\n`);
    expect(await verifyToken(token)).toBe(false);
  });

  it("is what makes a stolen cookie useless for guessing the password", async () => {
    // Two installations with the same password and different keys do not
    // honour each other's tokens, so the cookie's signature says nothing about
    // the password on its own.
    process.env.APP_PASSWORD = "hunter2";
    const other = like(() => "b".repeat(64));
    expect(await other.verifyToken(await createToken())).toBe(false);
    expect(await verifyToken(await other.createToken())).toBe(false);
  });

  it("still ends every session when the password changes", async () => {
    process.env.APP_PASSWORD = "hunter2";
    const token = await createToken();
    const seed = fs.readFileSync(seedFile(), "utf8");
    process.env.APP_PASSWORD = "different";
    expect(await verifyToken(token)).toBe(false);
    expect(fs.readFileSync(seedFile(), "utf8")).toBe(seed); // the key itself is untouched
  });

  it("is replaced by APP_SECRET when one is set, exactly as before, and then nothing is written down", async () => {
    process.env.APP_PASSWORD = "hunter2";
    process.env.APP_SECRET = "explicit";
    const token = await createToken();
    expect(await verifyToken(token)).toBe(true);
    expect(fs.existsSync(seedFile())).toBe(false);
    // Signed under the explicit secret, so a key file appearing later changes nothing.
    fs.writeFileSync(seedFile(), `${"c".repeat(64)}\n`);
    expect(await verifyToken(token)).toBe(true);
  });

  it("falls back to the password-derived key, once and out loud, when there is nowhere to keep one", async () => {
    process.env.APP_PASSWORD = "hunter2";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const homeless = like(() => null);
      const token = await homeless.createToken();
      expect(await homeless.verifyToken(token)).toBe(true);
      await homeless.createToken();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/APP_SECRET/);
    } finally {
      warn.mockRestore();
    }
  });

  it("answers null rather than a key it could not keep", () => {
    // The directory the key would go in is a file, so it can be neither read nor made.
    fs.writeFileSync(path.join(dataDir(), "not-a-directory"), "");
    const seed = createSessionSeed(() => path.join(dataDir(), "not-a-directory", "session-secret"));
    expect(seed()).toBeNull();
    // With a place to keep it, the same key comes back every time, and a
    // second reader finds the one the first made.
    const file = path.join(dataDir(), "keys", "session-secret");
    const first = createSessionSeed(file)();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(createSessionSeed(file)()).toBe(first);
  });
});

describe("login redirect target", () => {
  it("only ever returns a path on this origin", async () => {
    const { safeNext } = await import("@collectcollect/core/components/LoginForm");
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
