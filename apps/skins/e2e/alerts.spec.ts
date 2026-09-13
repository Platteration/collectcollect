import { expect, test } from "@playwright/test";

// Order matters: seeing the list marks it read, so the test that needs the
// seeded alert still unread runs first, with the marking refused.
test.describe("the alert feed", () => {
  test("says so when it cannot mark the list read, and puts a row back when a dismiss is refused", async ({ page }) => {
    await page.route("**/api/alerts", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "still full" }) })
        : route.continue(),
    );
    await page.goto("/alerts");
    const row = page.locator("li").filter({ hasText: "Karambit" });
    await expect(row).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /Could not mark these read/ })).toContainText("still full");
    await expect(row).toContainText("unread");
    // The header badge still counts it.
    await expect(page.getByRole("banner").getByRole("link", { name: /Alerts\s*1/ })).toBeVisible();

    // The server refuses; the page must not pretend otherwise.
    await page.route("**/api/alerts/*", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk is full" }) })
        : route.continue(),
    );
    await row.getByRole("button", { name: /Dismiss/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Could not dismiss/ })).toContainText("disk is full");
    await expect(row).toBeVisible();
  });

  test("lists what refresh raised, and seeing it clears the badge", async ({ page }) => {
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
    const row = page.locator("li").filter({ hasText: "Karambit" });
    await expect(row).toContainText("Worth more elsewhere");
    // Seeing the list is the acknowledgement, so the badge clears.
    await expect(page.getByRole("banner")).not.toContainText(/Alerts\s*\d/);
    // And the title leads to the item.
    await row.getByRole("link", { name: /Karambit/ }).click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
  });
});
