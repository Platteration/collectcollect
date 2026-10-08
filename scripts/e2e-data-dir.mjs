/** The variables the apps read their data directory from; each app has its own. */
const VARIABLES = ["DATA_DIR", "SKINS_DATA_DIR"];

/**
 * The throwaway data directory for the server being started, read from the
 * one variable that app uses. The command names the variable rather than the
 * script trying both: Playwright hands each server the parent shell's
 * environment as well as its own, so a developer with DATA_DIR exported who
 * ran the skins suite had a skins server's marker written into their real
 * card collection, and the next server die on the marker already being there.
 */
export function resolveDataDir(variable, env = process.env) {
  if (!VARIABLES.includes(variable)) {
    throw new Error(`Expected the data directory variable to be one of ${VARIABLES.join(", ")}, not ${JSON.stringify(variable ?? null)}`);
  }
  const directory = env[variable];
  if (!directory) throw new Error(`${variable} is not set: an e2e server needs a throwaway data directory`);
  return directory;
}
