import type { Reporter } from "@playwright/test/reporter";
import { removeTestDirectory } from "@collectcollect/core/test-directory";
import { engine } from "../src/lib/engine";
import { ROOT } from "./data-dir";

/**
 * Remove the run's throwaway collections when it ends. onEnd runs after the
 * servers are stopped, which is when their databases are let go; seed.ts
 * opened the reading collection in this process, so that one is closed here
 * before the directory goes.
 */
export default class CollectionCleanup implements Reporter {
  async onEnd(): Promise<void | { status: "failed" }> {
    try {
      engine.db.unlocked()?.close();
      await removeTestDirectory(ROOT, "collectcollect-retro-games-e2e-");
    } catch (error) {
      console.error("Could not clean up the test collections:", error);
      return { status: "failed" };
    }
  }
}
