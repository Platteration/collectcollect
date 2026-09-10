import { expect, test } from "@playwright/test";

test.describe("one item", () => {
  test("shows the float, the pattern and the stickers", async ({ page }) => {
    // Both Redlines carry the same name, so the search is on the collection,
    // which only the stickered one records.
    await page.goto("/inventory?q=Huntsman");
    await page.getByRole("link", { name: /AK-47 \| Redline/ }).click();

    await expect(page.getByRole("heading", { name: "AK-47 | Redline (Field-Tested)" })).toBeVisible();
    await expect(page.getByText("0.1601")).toBeVisible();
    await expect(page.getByText(/Field-Tested · \d+% through 0.15–0.38/)).toBeVisible();
    await expect(page.getByText(/Pattern 412/)).toBeVisible();
    await expect(page.getByText("iBUYPOWER | Katowice 2014")).toBeVisible();
    await expect(page.getByText("unscraped")).toBeVisible();
    await expect(page.getByText("35% scraped")).toBeVisible();
    await expect(page.getByText("First one I ever bought.")).toBeVisible();
  });

  test("keeps two copies of the same skin apart", async ({ page }) => {
    await page.goto("/inventory?q=Redline");
    const links = page.getByRole("link", { name: /AK-47 \| Redline/ });
    const first = await links.nth(0).getAttribute("href");
    const second = await links.nth(1).getAttribute("href");
    expect(first).not.toBe(second);

    await page.goto(first!);
    const floatOne = await page.getByText(/^0\.\d+$/).first().textContent();
    await page.goto(second!);
    const floatTwo = await page.getByText(/^0\.\d+$/).first().textContent();
    expect(floatOne).not.toBe(floatTwo);
  });

  test("says a trade-locked item cannot be sold, and when that lifts", async ({ page }) => {
    await page.goto("/inventory?locked=1");
    await page.getByRole("link", { name: /Karambit/ }).click();
    await expect(page.getByText(/It cannot be sold anywhere until then/)).toBeVisible();
  });

  test("keeps each purchase of a stack at its own price", async ({ page }) => {
    await page.goto("/inventory?category=case");
    await page.getByRole("link", { name: /Clutch Case/ }).click();
    // Twenty at 42 cents and fifteen at $1.15, listed separately and averaged
    // only for the headline.
    await expect(page.getByRole("cell", { name: "$0.42" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$1.15" })).toBeVisible();
    await expect(page.getByText(/paid \$0\.73/)).toBeVisible();
    await expect(page.getByText("$49.00 for 35")).toBeVisible();
  });

  test("has nothing at an id that is not there", async ({ page }) => {
    const response = await page.goto("/items/99999");
    expect(response?.status()).toBe(404);
  });
});
