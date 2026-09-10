import { defineConfig, devices } from "@playwright/test";
import { E2E_PASSWORD, LOCKED_DATA_DIR, READ_DATA_DIR, WRITE_DATA_DIR } from "./e2e/data-dir";

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
const WRITES = /(add|import|money|edit)\.spec\.ts/;
const AUTH = /auth\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/seed.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure", screenshot: "only-on-failure" },
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
      command: `npm start -- --port ${READ_PORT}`,
      port: READ_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: READ_DATA_DIR },
    },
    {
      command: `npm start -- --port ${WRITE_PORT}`,
      port: WRITE_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: WRITE_DATA_DIR },
    },
    {
      command: `npm start -- --port ${LOCKED_PORT}`,
      port: LOCKED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { SKINS_DATA_DIR: LOCKED_DATA_DIR, SKINS_APP_PASSWORD: E2E_PASSWORD },
    },
  ],
});
