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
