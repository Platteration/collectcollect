import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth";
import { domainAuth } from "../src/domain/auth";
import { domainDataDir } from "../src/domain/data-dir";
import { widgetEngine } from "./widgets";

// The spec in widgets.ts is "testdomain" with the prefix TESTDOMAIN, and
// tests/setup.ts gives each test its own TESTDOMAIN_DATA_DIR.
const ID = "testdomain";
const PREFIX = "TESTDOMAIN";
const seedFile = () => path.join(process.env.TESTDOMAIN_DATA_DIR!, "session-secret");

afterEach(() => {
  delete process.env.TESTDOMAIN_APP_PASSWORD;
  delete process.env.TESTDOMAIN_APP_SECRET;
});

/** The gate as it was: the same settings with no seed, so the key is derived from the password. */
function derivedFromPassword() {
  return createAuth({
    cookie: `cc_${ID}_session`,
    passwordEnv: `${PREFIX}_APP_PASSWORD`,
    secretEnv: `${PREFIX}_APP_SECRET`,
    secretPrefix: `collectcollect-${ID}:`,
  });
}

describe("a domain app's session key", () => {
  it("is a random key kept beside the collection, made on first use and readable by nobody else", async () => {
    process.env.TESTDOMAIN_APP_PASSWORD = "hunter2";
    const auth = domainAuth(ID, PREFIX);
    // Building the gate (the build does) writes nothing.
    expect(fs.existsSync(seedFile())).toBe(false);
    const token = await auth.createToken();
    expect(fs.readFileSync(seedFile(), "utf8").trim()).toMatch(/^[a-f0-9]{64}$/);
    if (process.platform !== "win32") expect(fs.statSync(seedFile()).mode & 0o777).toBe(0o600);
    expect(await auth.verifyToken(token)).toBe(true);
    // The key, not the password, is what signs: a different key refuses the token.
    fs.writeFileSync(seedFile(), `${"a".repeat(48)}\n`);
    expect(await auth.verifyToken(token)).toBe(false);
  });

  it("is what makes a stolen cookie useless for guessing the password", async () => {
    // A cookie signed with the key derived from the password alone is the
    // offline oracle the seed removes: the gate must not honour one, and its
    // own cookies must not verify under that derivation.
    process.env.TESTDOMAIN_APP_PASSWORD = "hunter2";
    const auth = domainAuth(ID, PREFIX);
    const old = derivedFromPassword();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await auth.verifyToken(await old.createToken())).toBe(false);
      expect(await old.verifyToken(await auth.createToken())).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it("is the same key in every copy of the gate, so the proxy honours what a route issued", async () => {
    // The proxy bundle and the route bundle each build their own gate.
    process.env.TESTDOMAIN_APP_PASSWORD = "hunter2";
    const forRoutes = domainAuth(ID, PREFIX);
    const forProxy = domainAuth(ID, PREFIX);
    expect(await forProxy.verifyToken(await forRoutes.createToken())).toBe(true);
    expect(await forRoutes.verifyToken(await forProxy.createToken())).toBe(true);
  });

  it("lands in the directory the collection is in", async () => {
    process.env.TESTDOMAIN_APP_PASSWORD = "hunter2";
    const engine = widgetEngine();
    await engine.auth.createToken();
    expect(fs.existsSync(path.join(engine.db.dataDir(), "session-secret"))).toBe(true);
    expect(engine.db.dataDir()).toBe(domainDataDir(PREFIX));
  });

  it("still ends every session when the password changes", async () => {
    process.env.TESTDOMAIN_APP_PASSWORD = "hunter2";
    const auth = domainAuth(ID, PREFIX);
    const token = await auth.createToken();
    const seed = fs.readFileSync(seedFile(), "utf8");
    process.env.TESTDOMAIN_APP_PASSWORD = "different";
    expect(await auth.verifyToken(token)).toBe(false);
    expect(fs.readFileSync(seedFile(), "utf8")).toBe(seed); // the key itself is untouched
  });

  it("is replaced by <PREFIX>_APP_SECRET when one is set, and then nothing is written down", async () => {
    process.env.TESTDOMAIN_APP_PASSWORD = "hunter2";
    process.env.TESTDOMAIN_APP_SECRET = "explicit";
    const auth = domainAuth(ID, PREFIX);
    const token = await auth.createToken();
    expect(await auth.verifyToken(token)).toBe(true);
    expect(fs.existsSync(seedFile())).toBe(false);
    // Signed under the explicit secret, so a key file appearing later changes nothing.
    fs.mkdirSync(path.dirname(seedFile()), { recursive: true });
    fs.writeFileSync(seedFile(), `${"c".repeat(64)}\n`);
    expect(await auth.verifyToken(token)).toBe(true);
  });

  it("falls back to the password-derived key, once and out loud, when there is nowhere to keep one", async () => {
    process.env.TESTDOMAIN_APP_PASSWORD = "hunter2";
    // The directory the key would go in is below a file, so it can be neither read nor made.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-domain-auth-"));
    fs.writeFileSync(path.join(base, "not-a-directory"), "");
    const before = process.env.TESTDOMAIN_DATA_DIR;
    process.env.TESTDOMAIN_DATA_DIR = path.join(base, "not-a-directory", "data");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const auth = domainAuth(ID, PREFIX);
      expect(await auth.verifyToken(await auth.createToken())).toBe(true);
      await auth.createToken();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("TESTDOMAIN_APP_SECRET");
    } finally {
      warn.mockRestore();
      process.env.TESTDOMAIN_DATA_DIR = before;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("where a domain app keeps its data", () => {
  it("is <PREFIX>_DATA_DIR, resolved, and otherwise data beside the working directory, and never made by asking", () => {
    const before = process.env.TESTDOMAIN_DATA_DIR;
    try {
      process.env.TESTDOMAIN_DATA_DIR = "relative/place";
      expect(domainDataDir(PREFIX)).toBe(path.resolve("relative/place"));
      delete process.env.TESTDOMAIN_DATA_DIR;
      expect(domainDataDir(PREFIX)).toBe(path.resolve(process.cwd(), "data"));
      // Asking for a prefix nothing sets gives the same default, and creates nothing.
      expect(domainDataDir("NOTHING_SETS_THIS")).toBe(path.resolve(process.cwd(), "data"));
      expect(fs.existsSync(path.resolve("relative/place"))).toBe(false);
    } finally {
      process.env.TESTDOMAIN_DATA_DIR = before;
    }
  });
});
