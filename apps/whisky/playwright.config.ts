import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { E2E_PASSWORD, LOCKED_DATA_DIR, READ_DATA_DIR, WRITE_DATA_DIR } from "./e2e/data-dir";

/**
 * End-to-end tests run against a real production build with collections of
 * their own, so they never touch a developer's bottles.
 *
 * Most of what is exercised here is the shared engine — the portfolio, the
 * collection page, an item, the report, adding by hand, importing a
 * spreadsheet and the password gate — which every app built on it renders the
 * same way. What is only whisky's is the open-a-bottle flow.
 */
const READ_PORT = 3230;
const WRITE_PORT = 3231;
const LOCKED_PORT = 3232;

// Every server reaches no host but its own (scripts/e2e-offline.mjs), so a
// price lookup made on the server fails at once rather than calling a real
// market, whether or not the machine has a PRICECHARTING_TOKEN or a network.
// (Playwright loads this file as CommonJS, since the package is not "type":
// "module" as cards and skins are, hence __dirname and not import.meta.dirname.)
const offline = [process.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(__dirname, "../../scripts/e2e-offline.mjs")).href}`].filter(Boolean).join(" ");

/** Specs that write. Everything else reads the seeded collection. */
const WRITES = /(add|import|open)\.spec\.ts/;
const AUTH = /auth\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/seed.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The html report is what the CI job uploads on failure; without a reporter
  // that writes one, the upload step finds nothing. The last reporter removes
  // the run's data directories.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }], ["./e2e/teardown.ts"]] : [["list"], ["./e2e/teardown.ts"]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "read", testIgnore: [WRITES, AUTH], use: { baseURL: `http://127.0.0.1:${READ_PORT}` } },
    { name: "write", testMatch: WRITES, use: { baseURL: `http://127.0.0.1:${WRITE_PORT}` } },
    { name: "auth", testMatch: AUTH, use: { baseURL: `http://127.0.0.1:${LOCKED_PORT}` } },
  ],
  webServer: [
    {
      command: `npm start -- --port ${READ_PORT}`,
      port: READ_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { WHISKY_DATA_DIR: READ_DATA_DIR, WHISKY_AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: offline },
    },
    {
      command: `npm start -- --port ${WRITE_PORT}`,
      port: WRITE_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { WHISKY_DATA_DIR: WRITE_DATA_DIR, WHISKY_AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: offline },
    },
    {
      command: `npm start -- --port ${LOCKED_PORT}`,
      port: LOCKED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { WHISKY_DATA_DIR: LOCKED_DATA_DIR, WHISKY_APP_PASSWORD: E2E_PASSWORD, WHISKY_AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: offline },
    },
  ],
});
