import fs from "node:fs";
import { ROOT } from "./data-dir";

/**
 * Remove the run's throwaway collections. They are named by pid, so a run
 * that is killed leaves a folder behind — but a run that finishes does not,
 * and a machine that runs the suite a hundred times does not fill up.
 */
export default async function teardown() {
  fs.rmSync(ROOT, { recursive: true, force: true });
}
