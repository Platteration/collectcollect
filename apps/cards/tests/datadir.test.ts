import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DB_FILE, dataDir, resetDataDirLookup } from "@/lib/db";

/**
 * The app used to run from the repository root and now runs from its own
 * workspace, which moves what `data` means. Getting this wrong would start a
 * working install against an empty folder and report an empty collection.
 */
describe("finding the collection when nothing says where it is", () => {
  const cwd = process.cwd();
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-datadir-"));
    delete process.env.DATA_DIR;
    resetDataDirLookup();
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
    resetDataDirLookup();
  });

  it("uses the folder beside it when that is where the collection is", () => {
    const app = path.join(root, "apps", "cards");
    fs.mkdirSync(path.join(app, "data"), { recursive: true });
    fs.writeFileSync(path.join(app, "data", DB_FILE), "");
    process.chdir(app);
    expect(dataDir()).toBe(fs.realpathSync(path.join(app, "data")));
  });

  it("finds a collection left where the app used to run from", () => {
    // The shape after the move: the app is two levels down, the collection is
    // still at the repository root where the previous version put it.
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", DB_FILE), "");
    const app = path.join(root, "apps", "cards");
    fs.mkdirSync(app, { recursive: true });
    process.chdir(app);
    expect(dataDir()).toBe(fs.realpathSync(path.join(root, "data")));
  });

  it("starts fresh when there is no collection anywhere", () => {
    const app = path.join(root, "apps", "cards");
    fs.mkdirSync(app, { recursive: true });
    process.chdir(app);
    // No database above and none beside: a new install gets its own folder.
    expect(dataDir()).toBe(path.join(app, "data"));
    expect(fs.existsSync(path.join(app, "data"))).toBe(true);
  });

  it("does the same for a folder that is there but empty", () => {
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    const app = path.join(root, "apps", "cards");
    fs.mkdirSync(app, { recursive: true });
    process.chdir(app);
    // A `data` directory with no database in it is not somebody's collection.
    expect(dataDir()).toBe(path.join(app, "data"));
  });

  it("does what it is told when DATA_DIR says so", () => {
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", DB_FILE), "");
    const app = path.join(root, "apps", "cards");
    fs.mkdirSync(app, { recursive: true });
    process.chdir(app);
    const chosen = path.join(root, "elsewhere");
    process.env.DATA_DIR = chosen;
    expect(dataDir()).toBe(chosen);
    delete process.env.DATA_DIR;
  });
});
