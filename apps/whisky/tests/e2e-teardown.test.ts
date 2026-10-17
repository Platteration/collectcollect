import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import CollectionCleanup from "../e2e/teardown";
import { LOCKED_DATA_DIR, READ_DATA_DIR, ROOT, WRITE_DATA_DIR } from "../e2e/data-dir";

/**
 * The browser suite's three throwaway collections live in the system temp
 * directory, and a run that left them behind put about a megabyte there each time.
 * The last reporter removes them when the run ends.
 */
describe("the browser suite's cleanup", () => {
  // Another run's directory: the same name with another pid.
  const neighbour = `${ROOT}0`;

  afterEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.rmSync(neighbour, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("removes the run's collections when it ends, and no one else's", async () => {
    for (const dir of [READ_DATA_DIR, WRITE_DATA_DIR, LOCKED_DATA_DIR]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "collectcollect-whisky.db"), "not a database");
    }
    fs.mkdirSync(neighbour);

    expect(await new CollectionCleanup().onEnd()).toBeUndefined();

    expect(fs.existsSync(ROOT)).toBe(false);
    expect(fs.existsSync(neighbour)).toBe(true);
  });

  it("has nothing to do when the run never made a collection", async () => {
    expect(fs.existsSync(ROOT)).toBe(false);
    expect(await new CollectionCleanup().onEnd()).toBeUndefined();
  });

  it("says so, and fails the run, when it cannot remove them", async () => {
    // Not a directory, so removing it is refused rather than followed.
    fs.writeFileSync(ROOT, "in the way");
    const said = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await new CollectionCleanup().onEnd()).toEqual({ status: "failed" });

    expect(said).toHaveBeenCalledWith("Could not clean up the test collections:", expect.objectContaining({ message: expect.stringContaining("not a real directory") }));
    expect(fs.existsSync(ROOT)).toBe(true);
  });
});
