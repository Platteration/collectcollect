import { expect, test } from "./fixtures";

test.describe("an address with nothing at it", () => {
  test("gets the app's own page, with the app still around it", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
    // The header survives, so there is somewhere to go.
    await expect(page.getByRole("banner").getByRole("link", { name: "Collection" })).toBeVisible();
    await page.getByRole("link", { name: "Open the collection" }).click();
    await expect(page).toHaveURL(/\/collection$/);
    // An item that is not there gets the same page.
    expect((await page.goto("/items/999999"))?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
  });
});
