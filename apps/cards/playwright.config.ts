import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { E2E_PASSWORD, LOCKED_DATA_DIR, OPEN_DATA_DIR } from "./e2e/data-dir";
import { E2E_ACCOUNTS, E2E_CLIENT } from "../../scripts/fake-google.mjs";

// Fixture timestamps render identically in the server and the browser on every host.
process.env.TZ = "UTC";

/**
 * End-to-end tests run against a real production build with its own throwaway
 * data directory, so they never touch a developer's collection. Two servers:
 * one open, one behind a password, since the gate changes every route.
 */
const OPEN_PORT = 3210;
const LOCKED_PORT = 3211;
// Both servers reach no host but their own (scripts/e2e-offline.mjs), so a
// price lookup made on the server fails at once rather than calling a real API.
const offline = [process.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(import.meta.dirname, "../../scripts/e2e-offline.mjs")).href}`].filter(Boolean).join(" ");
// The locked server also offers sign-in with Google, whose token endpoint and
// keys it reaches through a fake (scripts/e2e-google.mjs); the suite plays
// Google's sign-in page itself (auth.spec.ts).
const withGoogle = `${offline} --import=${pathToFileURL(path.join(import.meta.dirname, "../../scripts/e2e-google.mjs")).href}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalTeardown: "./e2e/stop-servers.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The html report is what the CI job uploads on failure; without a reporter
  // that writes one, the upload step finds nothing.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }], ["./e2e/teardown.ts"]] : [["list"], ["./e2e/teardown.ts"]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure", timezoneId: "UTC",
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : undefined },
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
      command: `node ../../scripts/e2e-server.mjs ${OPEN_PORT} DATA_DIR`,
      port: OPEN_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      // A placeholder key makes the client take the identify path, which the
      // tests intercept; no request ever reaches Anthropic.
      env: { DATA_DIR: OPEN_DATA_DIR, ANTHROPIC_API_KEY: "sk-ant-e2e-placeholder", AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: offline },
    },
    {
      command: `node ../../scripts/e2e-server.mjs ${LOCKED_PORT} DATA_DIR`,
      port: LOCKED_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      // Set up as README's "Host names and other sites" suggests for a domain
      // behind a TLS proxy the app was not told about: the https address it is
      // reached at, and the names it is still reached by at home, which are
      // plain http (auth.spec.ts, "an https address beside a home network's names").
      // Sign-in with Google beside the password, returning to this address,
      // which a browser counts as secure (auth.spec.ts, "sign-in with Google").
      env: {
        DATA_DIR: LOCKED_DATA_DIR, APP_PASSWORD: E2E_PASSWORD, AUTO_REFRESH_HOURS: "0", NODE_OPTIONS: withGoogle,
        APP_BASE_URL: "https://cards.example", ALLOWED_HOSTS: "cards.example,cardbox.lan,127.0.0.1",
        APP_URL: `http://127.0.0.1:${LOCKED_PORT}`, GOOGLE_CLIENT_ID: E2E_CLIENT.id, GOOGLE_CLIENT_SECRET: E2E_CLIENT.secret,
        GOOGLE_ALLOWED_SUBS: E2E_ACCOUNTS.owner.sub,
      },
    },
  ],
});
