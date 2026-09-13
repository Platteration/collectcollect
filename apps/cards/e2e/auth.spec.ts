import { expect, test } from "@playwright/test";

test.describe("password gate", () => {
  test("every page redirects to the login form until the password is given", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Wrong password")).toBeVisible();

    await page.getByLabel("Password").fill("e2e-secret");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Portfolio" })).toBeVisible();
  });

  test("an API call without a session is refused", async ({ request }) => {
    expect((await request.get("/api/cards")).status()).toBe(401);
  });

  test("the health check answers without a session, and gives nothing away", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string; database: boolean };
    expect(body).toMatchObject({ ok: true, app: "collectcollect" });
    expect(typeof body.database).toBe("boolean");
    expect(body).not.toHaveProperty("dataDir");
    // Every response, including this one, carries the security headers.
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
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
      await laptopPage.goto("/collection");
      await expect(laptopPage).toHaveURL(/\/collection$/);

      // The phone ends every session from Settings.
      const phonePage = await phone.newPage();
      await phonePage.goto("/settings");
      phonePage.once("dialog", (d) => d.accept());
      await phonePage.getByRole("button", { name: "Sign out everywhere" }).click();
      await expect(phonePage).toHaveURL(/\/login/);

      // The laptop's cookie is no longer honoured, on the API or the pages.
      expect((await laptop.request.get("/api/settings")).status()).toBe(401);
      await laptopPage.goto("/collection");
      await expect(laptopPage).toHaveURL(/\/login/);
    } finally {
      await phone.close();
      await laptop.close();
    }
  });

  test("signing out sends you back to the login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password").fill("e2e-secret");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("link", { name: "Collection" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/collection");
    await expect(page).toHaveURL(/\/login/);
  });
});
