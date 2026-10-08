import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDir } from "../../../scripts/e2e-data-dir.mjs";

/**
 * The e2e servers used to take whichever of the two data directory variables
 * was set, DATA_DIR first. Playwright hands each server the parent shell's
 * environment as well as its own, so a developer with DATA_DIR exported who
 * ran this app's suite had a skins server write its marker into their real
 * card collection. Now the command names the variable, and only that is read.
 */
describe("choosing the e2e server's data directory", () => {
  const env = { DATA_DIR: "/home/someone/cards/data", SKINS_DATA_DIR: "/tmp/skins-e2e" };

  it("reads only the variable the app being started names", () => {
    expect(resolveDataDir("SKINS_DATA_DIR", env)).toBe("/tmp/skins-e2e");
    expect(resolveDataDir("DATA_DIR", env)).toBe("/home/someone/cards/data");
  });

  it("refuses to guess when the variable is unnamed, unknown or unset", () => {
    expect(() => resolveDataDir(undefined, env)).toThrow(/one of DATA_DIR, SKINS_DATA_DIR/);
    expect(() => resolveDataDir("HOME", env)).toThrow(/one of DATA_DIR, SKINS_DATA_DIR/);
    expect(() => resolveDataDir("SKINS_DATA_DIR", { DATA_DIR: env.DATA_DIR })).toThrow(/SKINS_DATA_DIR is not set/);
  });

  it("is what the server script itself does, before it writes anything down", () => {
    // A shell with DATA_DIR exported and no SKINS_DATA_DIR: the script used to
    // take DATA_DIR and put its marker there. Now it stops, says which
    // variable it wanted, and the directory it must not touch stays empty.
    const cards = fs.mkdtempSync(path.join(os.tmpdir(), "not-the-e2e-dir-"));
    const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: cards };
    delete env.SKINS_DATA_DIR;
    try {
      const script = path.resolve(import.meta.dirname, "../../../scripts/e2e-server.mjs");
      const result = spawnSync(process.execPath, [script, "3299", "SKINS_DATA_DIR"], { env, encoding: "utf8", timeout: 5000 });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/SKINS_DATA_DIR is not set/);
      expect(fs.existsSync(path.join(cards, "e2e-server.pid"))).toBe(false);
    } finally {
      fs.rmSync(cards, { recursive: true, force: true });
    }
  });
});
