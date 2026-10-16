import { defineConfig, devices } from "@playwright/test";
import { E2E_PASSWORD, LOCKED_DATA_DIR, READ_DATA_DIR, WRITE_DATA_DIR } from "./e2e/data-dir";

/**
 * End-to-end tests run against a real production build with collections of
 * their own, so they never touch a developer's games.
 *
 * Most of what is exercised here is the shared engine — the portfolio, the
 * collection page, a game, the report, adding by hand, importing a
 * spreadsheet and the password gate — which every app built on it renders the
 * same way. What is only this app's is the graded slab on a game's page.
 */
const READ_PORT = 3240;
const WRITE_PORT = 3241;
const LOCKED_PORT = 3242;

/** Specs that write. Everything else reads the seeded collection. */
const WRITES = /(add|import)\.spec\.ts/;
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
      env: { RETRO_GAMES_DATA_DIR: READ_DATA_DIR },
    },
    {
      command: `npm start -- --port ${WRITE_PORT}`,
      port: WRITE_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { RETRO_GAMES_DATA_DIR: WRITE_DATA_DIR },
    },
    {
      command: `npm start -- --port ${LOCKED_PORT}`,
      port: LOCKED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { RETRO_GAMES_DATA_DIR: LOCKED_DATA_DIR, RETRO_GAMES_APP_PASSWORD: E2E_PASSWORD },
    },
  ],
});
