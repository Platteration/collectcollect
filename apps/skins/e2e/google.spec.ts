import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authorize, E2E_ACCOUNTS, type FakeAccount } from "../../../scripts/fake-google.mjs";

/**
 * The gate as sign-in with Google alone: this server has no password, and
 * SKINS_APP_URL, a Google client and one verified address on its list
 * (playwright.config.ts). Google's sign-in page is played by the test
 * (scripts/fake-google.mjs, answered at the protocol in googleSignsIn); its
 * token endpoint and keys by the fake that
 * scripts/e2e-google.mjs puts in front of the server's fetch. Every page is
 * held to the site's rules (fixtures.ts): no policy violation, no page error,
 * and no request off the site but the one navigation to Google's sign-in page.
 */
async function googleSignsIn(page: Page, account: FakeAccount) {
  // At the protocol, not through page.route: the browser reaches Google's page
  // by the redirect the app's start route answers with, and Playwright hands a
  // redirected request straight to the network, route or no route. Chromium's
  // own interception pauses it like any other.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://accounts.google.com/*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", (event) => {
    let answer: { responseCode: number; responseHeaders: Array<{ name: string; value: string }> };
    try {
      answer = { responseCode: 302, responseHeaders: [{ name: "Location", value: authorize(event.request.url, account) }] };
    } catch (error) {
      // A request Google would refuse to show: the test fails on the page it lands on.
      answer = { responseCode: 400, responseHeaders: [{ name: "X-Refused", value: String(error) }] };
    }
    void cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, ...answer, body: "" });
  });
}

test.describe("sign-in with Google, and no password", () => {
  test("every page asks for a sign-in, Google is the one way offered, and the owner gets in and back out", async ({ page }) => {
    await googleSignsIn(page, E2E_ACCOUNTS.owner);
    for (const path of ["/", "/inventory", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
    await expect(page.getByText("This inventory is private.")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);

    // Signing in returns you to the page you were trying to reach, the last one asked for above.
    await page.getByRole("link", { name: "Sign in with Google" }).click();
    await page.waitForURL(/\/settings$/);
    await expect(page.getByText("Sign-in with Google is on, so this app asks you to sign in once and then remembers the session.")).toBeVisible();
    await expect(page.getByText(/^Every device signed in stays signed in for 30 days/)).toBeVisible();

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an account not on the list is turned back, told once, and signed in nowhere", async ({ page }) => {
    await googleSignsIn(page, E2E_ACCOUNTS.stranger);
    await page.goto("/login");
    await page.getByRole("link", { name: "Sign in with Google" }).click();
    await expect(page.getByText("Sign-in didn't complete.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await page.reload();
    await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByText("Sign-in didn't complete.")).toHaveCount(0);
    expect((await page.request.get("/api/items")).status()).toBe(401);
  });

  test("signing out everywhere ends the other browser's Google session too", async ({ browser }) => {
    const phone = await browser.newContext();
    const laptop = await browser.newContext();
    try {
      for (const context of [phone, laptop]) {
        const page = await context.newPage();
        await googleSignsIn(page, E2E_ACCOUNTS.owner);
        await page.goto("/login");
        await page.getByRole("link", { name: "Sign in with Google" }).click();
        await page.waitForURL(/\/$/);
        await page.close();
      }
      expect((await laptop.request.get("/api/settings")).status()).toBe(200);

      const phonePage = await phone.newPage();
      await phonePage.goto("/settings");
      phonePage.once("dialog", (d) => d.accept());
      await phonePage.getByRole("button", { name: "Sign out everywhere" }).click();
      await expect(phonePage).toHaveURL(/\/login/);

      expect((await laptop.request.get("/api/settings")).status()).toBe(401);
    } finally {
      await phone.close();
      await laptop.close();
    }
  });

  test("the way in answers without a session, and there is no password to try", async ({ request }) => {
    const start = await request.get("/api/auth/google/start?return=%2Finventory", { maxRedirects: 0 });
    expect(start.status()).toBe(302);
    const to = new URL(start.headers()["location"] ?? "");
    expect(`${to.origin}${to.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("redirect_uri")).toBe(`${new URL(start.url()).origin}/api/auth/google/callback`);
    expect(start.headers()["set-cookie"]).toMatch(/^__Host-collectcollect-skins-oauth=[^;]+; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(start.headers()["cache-control"]).toBe("no-store");
    expect(start.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    // A callback with no sign-in under way goes back to the login page.
    const back = await request.get("/api/auth/google/callback?state=x&code=y", { maxRedirects: 0 });
    expect(back.status()).toBe(302);
    expect(back.headers()["location"]).toMatch(/\/login\?signin=failed$/);
    expect((await request.post("/api/auth", { data: { password: "anything" } })).status()).toBe(400);
    expect((await request.get("/api/items")).status()).toBe(401);
  });
});
