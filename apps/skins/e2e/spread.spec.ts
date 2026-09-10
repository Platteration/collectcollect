import { expect, test } from "@playwright/test";

test.describe("where to sell", () => {
  test("ranks by what the whole holding is worth moving, not by the price tag", async ({ page }) => {
    await page.goto("/spread");
    const rows = page.locator("li").filter({ has: page.getByRole("link") });
    // The knife's difference is the largest, then thirty-five cases nine cents
    // apart, then one rifle worth $2.42 more elsewhere.
    await expect(page.getByText("+$88.60")).toBeVisible();
    await expect(page.getByText("+$3.15")).toBeVisible();
    await expect(page.getByText("+$2.42")).toBeVisible();
    await expect(rows.first()).toContainText("Karambit");
  });

  test("never lets Steam win, because its proceeds are not money", async ({ page }) => {
    await page.goto("/spread");
    // Steam lists the knife at $1,400 — more than either cash market, and more
    // than either nets. It is still not the answer.
    await expect(page.getByText(/CSFloat nets \$1,127\.00/)).toBeVisible();
    await expect(page.getByText(/Steam Community Market would show .* in wallet funds/)).toBeVisible();
  });

  test("leaves a trade-locked item out of the total it says you could realise", async ({ page }) => {
    await page.goto("/spread");
    // $3.15 + $2.42, with the locked knife's $88.60 excluded.
    await expect(page.getByText(/Together that is \$5\.57/)).toBeVisible();
    await expect(page.getByText(/1 of them is trade locked/)).toBeVisible();
    await expect(page.getByText(/not actionable yet/)).toBeVisible();
  });

  test("says how many it had nothing to compare", async ({ page }) => {
    await page.goto("/spread");
    // Two items only one market is listing. Comparing those against nothing
    // would invent a spread.
    await expect(page.getByText(/2 items have only one market listing them/)).toBeVisible();
  });

  test("shows the same arithmetic on the item itself", async ({ page }) => {
    await page.goto("/spread");
    await page.getByRole("link", { name: /Karambit/ }).first().click();
    await expect(page.getByRole("heading", { name: "Where it is worth most" })).toBeVisible();

    // Two tables, and Steam is in neither of the ones that pay money.
    const cash = page.locator("table").filter({ hasText: "Markets that pay money" });
    await expect(cash).toContainText("CSFloat");
    await expect(cash).toContainText("Skinport");
    await expect(cash).not.toContainText("Steam");

    const wallet = page.locator("table").filter({ hasText: "Steam wallet" });
    await expect(wallet).toContainText("Steam Community Market");
    await expect(page.getByText(/Listed apart because these proceeds cannot be withdrawn/)).toBeVisible();

    await expect(page.getByText(/None of this can be acted on until then/)).toBeVisible();
  });

  test("prices a whole stack as a stack", async ({ page }) => {
    await page.goto("/inventory?category=case");
    await page.getByRole("link", { name: /Clutch Case/ }).click();
    const cash = page.locator("table").filter({ hasText: "Markets that pay money" });
    // Nine cents each is only interesting because there are thirty-five.
    // Each net is rounded to the cent first, because that is what one sale
    // actually pays: 35 × $1.32, not 35 × $1.323.
    await expect(cash).toContainText("For 35");
    await expect(cash.getByRole("cell", { name: "$46.20" })).toBeVisible();
  });
});
