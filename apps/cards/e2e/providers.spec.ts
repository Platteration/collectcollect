import { expect, test } from "./fixtures";

test.describe("Settings' data sources", () => {
  test("eBay sold listings is listed, and its Test connection answers rather than refusing the id", async ({ page }) => {
    await page.goto("/settings");
    const row = page.locator("li", { hasText: "eBay sold listings" });
    await expect(row).toContainText("Not configured");
    await expect(row).toContainText("EBAY_CLIENT_ID");
    await row.getByRole("button", { name: "Test connection" }).click();
    // No keys on this server, so nothing is asked of eBay; the answer says so.
    await expect(row.getByRole("status")).toHaveText("Add this provider's key to the environment and restart the app.");
  });
});
