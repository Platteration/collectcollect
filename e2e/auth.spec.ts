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

  test("the login page shows nothing but the login form", async ({ page }) => {
    await page.goto("/login");
    // The nav would offer links that bounce straight back here, a sign-out
    // button, and the number of unread alerts in a collection nobody has
    // opened yet.
    for (const link of ["Portfolio", "Collection", "Sets", "Grading", "Alerts", "Report", "Settings"]) {
      await expect(page.getByRole("link", { name: link })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("an API call without a session is refused", async ({ request }) => {
    expect((await request.get("/api/cards")).status()).toBe(401);
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
