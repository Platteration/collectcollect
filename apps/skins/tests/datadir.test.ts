import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DB_FILE, dataDir, resetDataDirLookup } from "@/lib/db";

/**
 * Where the inventory is when nothing says. This app has always run from its
 * own workspace, so the answer is always `data` beside it — but a full
 * inventory sitting a level up while an empty folder is used is worth a word.
 */
describe("finding the inventory when nothing says where it is", () => {
  const cwd = process.cwd();
  const env = process.env.SKINS_DATA_DIR;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skins-datadir-"));
    delete process.env.SKINS_DATA_DIR;
    resetDataDirLookup();
  });

  afterEach(() => {
    process.chdir(cwd);
    process.env.SKINS_DATA_DIR = env;
    fs.rmSync(root, { recursive: true, force: true });
    resetDataDirLookup();
    vi.restoreAllMocks();
  });

  it("uses the folder beside it", () => {
    const app = path.join(root, "apps", "skins");
    fs.mkdirSync(app, { recursive: true });
    process.chdir(app);
    expect(dataDir()).toBe(path.join(app, "data"));
    expect(fs.existsSync(path.join(app, "data"))).toBe(true);
  });

  it("does not switch to an inventory it finds above, but does say so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", DB_FILE), "");
    const app = path.join(root, "apps", "skins");
    fs.mkdirSync(app, { recursive: true });
    process.chdir(app);
    expect(dataDir()).toBe(path.join(app, "data"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(path.join(root, "data"));
    expect(warn.mock.calls[0][0]).toContain("SKINS_DATA_DIR");
    // Once, not on every request.
    dataDir();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("says nothing when there is nothing to find, or when the folder beside it is the inventory", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", DB_FILE), "");
    const app = path.join(root, "apps", "skins");
    fs.mkdirSync(path.join(app, "data"), { recursive: true });
    fs.writeFileSync(path.join(app, "data", DB_FILE), "");
    process.chdir(app);
    expect(dataDir()).toBe(path.join(app, "data"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("does what it is told when SKINS_DATA_DIR says so", () => {
    const chosen = path.join(root, "elsewhere");
    process.env.SKINS_DATA_DIR = chosen;
    expect(dataDir()).toBe(chosen);
  });
});
