import { defineConfig, devices } from "@playwright/test";
import { E2E_PASSWORD, LOCKED_DATA_DIR, READ_DATA_DIR, WRITE_DATA_DIR } from "./e2e/data-dir";

// Fixture timestamps render identically in the server and the browser on every host.
process.env.TZ = "UTC";

/**
 * End-to-end tests run against a real production build with inventories of
 * their own, so they never touch a developer's data.
 *
 * Three servers: one holding the seeded inventory the reading specs are held
 * to exactly, one empty for the specs that add and import, and one behind a
 * password, since the gate changes every route.
 */
const READ_PORT = 3220;
const WRITE_PORT = 3221;
const LOCKED_PORT = 3222;

/** Specs that write. Everything else reads the seeded inventory. */
const WRITES = /(add|backup|edit|import|money)\.spec\.ts/;
const AUTH = /auth\.spec\.ts/;

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
      testIgnore: [WRITES, AUTH],
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
  ],
  webServer: [
    {
      command: `node ../../scripts/e2e-server.mjs ${READ_PORT}`,
      port: READ_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: READ_DATA_DIR, SKINS_AUTO_REFRESH_HOURS: "0" },
    },
    {
      command: `node ../../scripts/e2e-server.mjs ${WRITE_PORT}`,
      port: WRITE_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: WRITE_DATA_DIR, SKINS_AUTO_REFRESH_HOURS: "0" },
    },
    {
      command: `node ../../scripts/e2e-server.mjs ${LOCKED_PORT}`,
      port: LOCKED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: LOCKED_DATA_DIR, SKINS_APP_PASSWORD: E2E_PASSWORD, SKINS_AUTO_REFRESH_HOURS: "0" },
    },
  ],
});
