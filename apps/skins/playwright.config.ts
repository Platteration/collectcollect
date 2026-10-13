import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { E2E_PASSWORD, GOOGLE_DATA_DIR, LOCKED_DATA_DIR, READ_DATA_DIR, WRITE_DATA_DIR } from "./e2e/data-dir";
import { E2E_ACCOUNTS, E2E_CLIENT } from "../../scripts/fake-google.mjs";

// Fixture timestamps render identically in the server and the browser on every host.
process.env.TZ = "UTC";

/**
 * End-to-end tests run against a real production build with inventories of
 * their own, so they never touch a developer's data.
 *
 * Four servers: one holding the seeded inventory the reading specs are held
 * to exactly, one empty for the specs that add and import, one behind a
 * password, and one behind sign-in with Google alone, since the gate changes
 * every route.
 */
const READ_PORT = 3220;
const WRITE_PORT = 3221;
const LOCKED_PORT = 3222;
const GOOGLE_PORT = 3223;
// Every server reaches no host but its own (scripts/e2e-offline.mjs), so a
// price lookup made on the server fails at once rather than calling a market.
const offline = [process.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(import.meta.dirname, "../../scripts/e2e-offline.mjs")).href}`].filter(Boolean).join(" ");
// The Google server reaches Google's token endpoint and keys through a fake
// (scripts/e2e-google.mjs); the suite plays Google's sign-in page itself.
const withGoogle = `${offline} --import=${pathToFileURL(path.join(import.meta.dirname, "../../scripts/e2e-google.mjs")).href}`;

/** Specs that write. Everything else reads the seeded inventory. */
const WRITES = /(add|backup|edit|import|money|offline|pictures)\.spec\.ts/;
const AUTH = /auth\.spec\.ts/;
const GOOGLE = /google\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/seed.ts",
  globalTeardown: "./e2e/stop-servers.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The html report is what the CI job uploads on failure; without a reporter
  // that writes one, the upload step finds nothing.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }], ["./e2e/teardown.ts"]] : [["list"], ["./e2e/teardown.ts"]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure", screenshot: "only-on-failure", timezoneId: "UTC",
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : undefined },
  projects: [
    {
      name: "read",
      testIgnore: [WRITES, AUTH, GOOGLE],
      use: { baseURL: `http://127.0.0.1:${READ_PORT}` },
    },
    {
      name: "write",
      testMatch: WRITES,
      use: { baseURL: `http://127.0.0.1:${WRITE_PORT}` },
    },
    {
      name: "auth",
      testMatch: AUTH,
      use: { baseURL: `http://127.0.0.1:${LOCKED_PORT}` },
    },
    {
      name: "google",
      testMatch: GOOGLE,
      use: { baseURL: `http://127.0.0.1:${GOOGLE_PORT}` },
    },
  ],
  webServer: [
    {
      command: `node ../../scripts/e2e-server.mjs ${READ_PORT} SKINS_DATA_DIR`,
      port: READ_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: READ_DATA_DIR, SKINS_AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: offline },
    },
    {
      command: `node ../../scripts/e2e-server.mjs ${WRITE_PORT} SKINS_DATA_DIR`,
      port: WRITE_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: WRITE_DATA_DIR, SKINS_AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: offline },
    },
    {
      command: `node ../../scripts/e2e-server.mjs ${LOCKED_PORT} SKINS_DATA_DIR`,
      port: LOCKED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: LOCKED_DATA_DIR, SKINS_APP_PASSWORD: E2E_PASSWORD, SKINS_AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: offline },
    },
    {
      command: `node ../../scripts/e2e-server.mjs ${GOOGLE_PORT} SKINS_DATA_DIR`,
      port: GOOGLE_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      // No password: the gate is sign-in with Google alone, for the one
      // verified address on its list, returning to this address, which a
      // browser counts as secure (google.spec.ts).
      env: {
        SKINS_DATA_DIR: GOOGLE_DATA_DIR, SKINS_AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: withGoogle,
        SKINS_APP_URL: `http://127.0.0.1:${GOOGLE_PORT}`, SKINS_GOOGLE_CLIENT_ID: E2E_CLIENT.id, SKINS_GOOGLE_CLIENT_SECRET: E2E_CLIENT.secret,
        SKINS_GOOGLE_ALLOWED_EMAILS: E2E_ACCOUNTS.owner.email,
      },
    },
  ],
});
