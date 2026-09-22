import pkg from "../../package.json";

/**
 * What the About footer and the health endpoint report, named once so the two
 * cannot drift. Read from package.json rather than from `npm_package_version`:
 * npm sets that for `npm start`, and it is unset when the server is started as
 * `next start` or as the standalone server.js the Docker image runs.
 */
export const APP_NAME = "CollectCollect";
export const APP_VERSION: string = pkg.version;
export const SOURCE_URL = "https://github.com/Platteration/collectcollect";
export const LICENSE_URL = `${SOURCE_URL}/blob/HEAD/LICENSE`;
