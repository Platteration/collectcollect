import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

/**
 * End-to-end tests run against a real production build with its own throwaway
 * data directory, so they never touch a developer's collection. Two servers:
 * one open, one behind a password, since the gate changes every route.
 */
const OPEN_PORT = 3210;
const LOCKED_PORT = 3211;
const dataRoot = path.join(os.tmpdir(), `collectcollect-e2e-${process.pid}`);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
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
      env: { DATA_DIR: path.join(dataRoot, "open"), ANTHROPIC_API_KEY: "sk-ant-e2e-placeholder", AUTO_REFRESH_HOURS: "0" },
    },
    {
      command: `npm start -- --port ${LOCKED_PORT}`,
      port: LOCKED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { DATA_DIR: path.join(dataRoot, "locked"), APP_PASSWORD: "e2e-secret", AUTO_REFRESH_HOURS: "0" },
    },
  ],
});
