import { afterEach, describe, expect, it } from "vitest";
import { authEnabled, createToken, passwordMatches, timingSafeEqual, verifyToken } from "@/lib/auth";

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

  it("compares strings without leaking through length", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
