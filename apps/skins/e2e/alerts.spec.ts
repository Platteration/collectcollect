import { expect, test } from "@playwright/test";

test.describe("the alert feed", () => {
  test("lists what refresh raised, counted in the header", async ({ page }) => {
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
    const row = page.locator("li").filter({ hasText: "Karambit" });
    await expect(row).toContainText("Worth more elsewhere");
    await expect(row).toContainText("unread");
    // The header badge counts it.
    await expect(page.getByRole("banner").getByRole("link", { name: /Alerts\s*1/ })).toBeVisible();
    // And the title leads to the item.
    await row.getByRole("link", { name: /Karambit/ }).click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
  });

  test("puts a row back and says why when a dismiss is refused", async ({ page }) => {
    await page.goto("/alerts");
    const row = page.locator("li").filter({ hasText: "Karambit" });
    await expect(row).toBeVisible();

    // The server refuses; the page must not pretend otherwise.
    await page.route("**/api/alerts/*", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk is full" }) })
        : route.continue(),
    );
    await row.getByRole("button", { name: /Dismiss/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Could not dismiss/ })).toContainText("disk is full");
    await expect(row).toBeVisible();

    await page.route("**/api/alerts", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "still full" }) })
        : route.continue(),
    );
    await page.getByRole("button", { name: /Mark all 1 read/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Could not mark them read/ })).toContainText("still full");
    await expect(row).toContainText("unread");
  });
});
