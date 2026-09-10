import { defineConfig, devices } from "@playwright/test";
import { E2E_DATA_DIR } from "./e2e/data-dir";

/**
 * End-to-end tests run against a real production build with an inventory of
 * their own, so they never touch a developer's data. The inventory is built by
 * the global setup before the server starts, since there is no intake API to
 * seed through yet.
 */
const PORT = 3220;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/seed.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `npm start -- --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SKINS_DATA_DIR: E2E_DATA_DIR },
  },
});
