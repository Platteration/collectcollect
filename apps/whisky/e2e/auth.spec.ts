import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "./data-dir";

test.describe("password gate", () => {
  test("every page redirects to the login form until the password is given", async ({ page }) => {
    for (const path of ["/", "/collection", "/add", "/report", "/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    }
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /Settings/ })).toBeVisible();
  });

  test("an API call without a session is refused", async ({ request }) => {
    const response = await request.get("/api/items");
    expect(response.status()).toBe(401);
  });

  test("the installed app's shell needs no session either", async ({ request }) => {
    // A phone installs the app, and opens it with no network, before anyone has signed in.
    for (const path of ["/offline", "/manifest.webmanifest", "/sw.js", "/guard.js", "/favicon.ico", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
    }
    // And only that: the collection is still behind the password.
    expect((await request.get("/collection", { maxRedirects: 0 })).status()).toBe(307);
  });

  test("the service worker installs on the login page, before anyone has signed in", async ({ page }) => {
    await page.goto("/login");
    await page.waitForFunction(() => (window as unknown as { __collectcollectStarted?: boolean }).__collectcollectStarted === true);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Installing fetches the shell, and a sign-in page standing in for any of it would be kept as the offline notice.
    const offline = await page.evaluate(async () => (await caches.match("/offline"))?.text());
    expect(offline).toContain("No connection");
    expect(offline).not.toContain("Sign in");
  });

  test("signing out sends you back to the login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The sign-out button is only rendered behind a session, so its arrival is
    // the signal that the password was taken.
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    await signOut.click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
