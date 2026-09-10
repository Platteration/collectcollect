import { expect, type Page, test } from "@playwright/test";

/** The filter chips, which share their wording with the items they filter to. */
const filters = (page: Page) => page.getByRole("navigation", { name: "Filters" });

test.describe("the inventory", () => {
  test("lists what is held, and narrows by the things CS2 is sorted by", async ({ page }) => {
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();

    // Two AK Redlines at the same wear tier are two objects, not one stack.
    await expect(page.getByRole("link", { name: /AK-47 \| Redline \(Field-Tested\)/ })).toHaveCount(2);

    await filters(page).getByRole("link", { name: "Case", exact: true }).click();
    await expect(page).toHaveURL(/category=case/);
    await expect(page.getByRole("link", { name: /Clutch Case/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Karambit/ })).toHaveCount(0);

    // Clicking it again clears it.
    await filters(page).getByRole("link", { name: "Case", exact: true }).click();
    await expect(page.getByRole("link", { name: /Karambit/ })).toBeVisible();
  });

  test("stacks one filter on another instead of replacing it", async ({ page }) => {
    await page.goto("/inventory");
    await filters(page).getByRole("link", { name: "Weapon", exact: true }).click();
    await filters(page).getByRole("link", { name: "StatTrak™", exact: true }).click();
    await expect(page).toHaveURL(/category=weapon/);
    await expect(page).toHaveURL(/stattrak=1/);
    await expect(page.getByRole("link", { name: /Asiimov/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Redline/ })).toHaveCount(0);
  });

  test("searches for the characters typed, and keeps the filters already set", async ({ page }) => {
    await page.goto("/inventory?category=weapon");
    await page.getByLabel("Search the inventory").fill("Redline");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/category=weapon/);
    await expect(page.getByRole("link", { name: /Redline/ })).toHaveCount(2);
  });

  test("says so when nothing matches rather than showing an empty grid", async ({ page }) => {
    await page.goto("/inventory?q=nothinglikethis");
    await expect(page.getByText("Nothing matches.")).toBeVisible();
    await page.getByRole("link", { name: "Clear the filters" }).click();
    await expect(page.getByRole("link", { name: /Karambit/ })).toBeVisible();
  });

  test("shows what cannot be moved yet", async ({ page }) => {
    await page.goto("/inventory?locked=1");
    await expect(page.getByText(/Trade locked until/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Karambit/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Clutch Case/ })).toHaveCount(0);
  });
});
