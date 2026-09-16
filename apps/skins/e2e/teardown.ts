import type { Reporter } from "@playwright/test/reporter";
import { closeDatabase } from "../src/lib/db";
import { removeTestDirectory } from "@collectcollect/core/test-directory";
import { ROOT } from "./data-dir";

/** onEnd runs after webServer shutdown; globalTeardown ran while SQLite was still open. */
export default class CollectionCleanup implements Reporter {
  async onEnd(): Promise<void | { status: "failed" }> {
    try {
      closeDatabase();
      await removeTestDirectory(ROOT, "collectcollect-skins-e2e-");
    } catch (error) {
      console.error("Could not clean up the test collection:", error);
      return { status: "failed" };
    }
  }
}