import { documentedHeaders, expect, headerProblems, test } from "./fixtures";
import { E2E_PASSWORD } from "./data-dir";

test.describe("password gate", () => {
  test("every page redirects to the login form until the password is given", async ({ page }) => {
    for (const path of ["/", "/inventory", "/add", "/import", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }

    // Signing in returns you to the page you were trying to reach, which is the
    // last one the loop above asked for.
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByText("Inventory value", { exact: true })).toBeVisible();
  });

  test("the login page shows a stranger none of the app", async ({ page }) => {
    // No nav that bounces straight back to this page, no unread-alert count,
    // no Sign out and no Add: the chrome is for someone signed in.
    await page.goto("/login");
    await expect(page.getByLabel("Password")).toBeVisible();
    for (const name of ["Inventory", "Alerts", "Settings"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^\+ Add/ })).toHaveCount(0);
  });

  test("an API call without a session is refused", async ({ request }) => {
    expect((await request.get("/api/items")).status()).toBe(401);
    // A write is refused the same way, not with a redirect a fetch would follow.
    expect((await request.post("/api/items", { data: { marketHashName: "Clutch Case" } })).status()).toBe(401);
  });

  test("the installed app's shell needs no session either", async ({ request }) => {
    for (const path of ["/offline", "/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
    }
  });

  test("the health check answers without a session", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect((await res.json()) as object).toMatchObject({ ok: true, app: "collectcollect-skins" });
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("a wrong password does not sign anyone in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password").fill("not-it");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Wrong password")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signing out everywhere ends the other browser's session too", async ({ browser }) => {
    const phone = await browser.newContext();
    const laptop = await browser.newContext();
    try {
      for (const context of [phone, laptop]) {
        const page = await context.newPage();
        await page.goto("/login");
        await page.getByLabel("Password").fill("e2e-secret");
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL(/\/$/);
        await page.close();
      }
      // Both signed in; the laptop is left where it is.
      expect((await laptop.request.get("/api/health")).status()).toBe(200);
      const laptopPage = await laptop.newPage();
      await laptopPage.goto("/inventory");
      await expect(laptopPage).toHaveURL(/\/inventory$/);

      // The phone ends every session from Settings.
      const phonePage = await phone.newPage();
      await phonePage.goto("/settings");
      phonePage.once("dialog", (d) => d.accept());
      await phonePage.getByRole("button", { name: "Sign out everywhere" }).click();
      await expect(phonePage).toHaveURL(/\/login/);

      // The laptop's cookie is no longer honoured, on the API or the pages.
      expect((await laptop.request.get("/api/settings")).status()).toBe(401);
      await laptopPage.goto("/inventory");
      await expect(laptopPage).toHaveURL(/\/login/);
    } finally {
      await phone.close();
      await laptop.close();
    }
  });

  test("signing out sends you back to the login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Signing in is a full navigation, and the server-rendered nav is visible
    // before the scripts that wire its buttons have run: a click in that gap
    // sends nothing. waitForURL also waits for the load event, by which time
    // React is listening and replays a click it gets.
    await page.waitForURL("/");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("the website, behind the password", () => {
  test("robots.txt, security.txt, the safety net and the framework's files answer without a session, under the same headers", async ({ request }) => {
    const login = await (await request.get("/login")).text();
    const chunk = /src="(\/_next\/static\/chunks\/[^"]+\.js)"/.exec(login)?.[1];
    expect(chunk).toBeTruthy();
    for (const pathname of ["/robots.txt", "/.well-known/security.txt", "/guard.js", chunk!]) {
      const res = await request.get(pathname, { maxRedirects: 0 });
      expect(res.status(), pathname).toBe(200);
      expect(headerProblems(res, documentedHeaders()), pathname).toEqual([]);
    }
    // Nothing else beside them: another file in the same folder still needs the password.
    expect((await request.get("/.well-known/other.txt", { maxRedirects: 0 })).status()).toBe(307);
  });

  test("the login page starts under the policy, and its safety net stays down", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.waitForTimeout(5_000);
    await expect(page.locator(".boot-note")).toHaveCount(0);
  });

  test("without JavaScript, a password typed into the login form never leaves the page", async ({ playwright, baseURL }) => {
    const browser = await playwright.chromium.launch({
      args: ["--blink-settings=scriptEnabled=false"],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    });
    try {
      const page = await browser.newPage({ baseURL });
      const sent: string[] = [];
      page.on("request", (r) => sent.push(r.url()));
      await page.goto("/login");
      await expect(page.locator(".noscript-note")).toBeVisible();
      await page.getByLabel("Password").fill("typed-before-any-script");
      await page.getByLabel("Password").press("Enter");
      await page.waitForTimeout(1_000);
      expect(new URL(page.url()).pathname).toBe("/login");
      expect(sent.filter((url) => url.includes("typed-before-any-script"))).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
