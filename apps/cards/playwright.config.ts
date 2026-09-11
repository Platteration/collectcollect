import { defineConfig, devices } from "@playwright/test";
import { E2E_PASSWORD, LOCKED_DATA_DIR, OPEN_DATA_DIR } from "./e2e/data-dir";

/**
 * End-to-end tests run against a real production build with its own throwaway
 * data directory, so they never touch a developer's collection. Two servers:
 * one open, one behind a password, since the gate changes every route.
 */
const OPEN_PORT = 3210;
const LOCKED_PORT = 3211;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalTeardown: "./e2e/teardown.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The html report is what the CI job uploads on failure; without a reporter
  // that writes one, the upload step finds nothing.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "app",
      testIgnore: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${OPEN_PORT}` },
    },
    {
      name: "auth",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${LOCKED_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npm start -- --port ${OPEN_PORT}`,
      port: OPEN_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      // A placeholder key makes the client take the identify path, which the
      // tests intercept; no request ever reaches Anthropic.
      env: { DATA_DIR: OPEN_DATA_DIR, ANTHROPIC_API_KEY: "sk-ant-e2e-placeholder", AUTO_REFRESH_HOURS: "0" },
    },
    {
      command: `npm start -- --port ${LOCKED_PORT}`,
      port: LOCKED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { DATA_DIR: LOCKED_DATA_DIR, APP_PASSWORD: E2E_PASSWORD, AUTO_REFRESH_HOURS: "0" },
    },
  ],
});
