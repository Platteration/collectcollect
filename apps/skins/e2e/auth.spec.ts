import { expect, test } from "@playwright/test";
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
    await expect(page.getByText("Inventory value")).toBeVisible();
  });

  test("an API call without a session is refused", async ({ request }) => {
    expect((await request.get("/api/items")).status()).toBe(401);
    // A write is refused the same way, not with a redirect a fetch would follow.
    expect((await request.post("/api/items", { data: { marketHashName: "Clutch Case" } })).status()).toBe(401);
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

  test("signing out sends you back to the login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
