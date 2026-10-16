import { expect, test } from "./fixtures";
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

  test("the health check answers without a session, and gives nothing away", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string; database: boolean };
    expect(body).toMatchObject({ ok: true, app: "collectcollect-whisky" });
    expect(typeof body.database).toBe("boolean");
    expect(Object.keys(body).sort()).toEqual(["app", "database", "ok"]);
    // Every response, including this one, carries the security headers.
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
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

test.describe("on a phone", () => {
  test("Sign out is a 44 px target on touch, and the header still fits at 360 px", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    const box = (await signOut.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // With Sign out beside the theme buttons the controls no longer fit one row; they wrap, none cut off.
    const spill = await page.evaluate(() => [...document.querySelectorAll("header :is(button, a, summary):not(.cc-palette-panel *)")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > 360.5; })
      .map((el) => el.textContent));
    expect(spill).toEqual([]);
    expect(await page.evaluate(() => document.querySelector("header")!.scrollWidth)).toBeLessThanOrEqual(360);
    // On one row, not a third row for the last of them: the theme buttons, Sign out and + Add are level.
    const centres = await page.evaluate(() => ["Light", "Sign out", "+ Add"].map((name) => {
      const el = [...document.querySelectorAll("header button, header a")].find((e) => e.getAttribute("aria-label") === name || e.textContent?.trim().startsWith(name))!;
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    }));
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(8);

    await signOut.click();
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
