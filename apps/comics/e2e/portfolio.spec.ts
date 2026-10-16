import { expect, test } from "@playwright/test";

test.describe("the portfolio", () => {
  test("totals what is held and shows what it is made of", async ({ page }) => {
    await page.goto("/");
    // $1,400 for the slab and 3 x $18 for the raw stack.
    await expect(page.getByText("$1,454.00").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top holdings" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Amazing Spider-Man/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By publisher" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By format" })).toBeVisible();
  });

  test("counts the copies rather than the rows, and says how many are priced", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("5 copies")).toBeVisible();
    await expect(page.getByText("2 of 3")).toBeVisible();
    await expect(page.getByText("the rest are unvalued")).toBeVisible();
  });

  test("leaves a comic nobody priced out of the return instead of calling it free", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/1 bought but not yet priced/)).toBeVisible();
  });

  test("separates what is only on paper from what was actually banked", async ({ page }) => {
    await page.goto("/");
    // Unrealised: $1,454 against $924 paid for the copies that have both.
    await expect(page.getByText("$530.00")).toBeVisible();
    await expect(page.getByText(/\+57\.4% on \$924\.00/)).toBeVisible();
    // Realised: $300 less $10 of fees less the $240 it cost.
    await expect(page.getByText("$50.00").first()).toBeVisible();
    await expect(page.getByText("1 sale")).toBeVisible();
  });

  test("reads the value chart with a keyboard and a screen reader", async ({ page }) => {
    await page.goto("/");
    const chart = page.getByRole("img", { name: /Collection value over time/ });
    await expect(chart).toBeVisible();
    await chart.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[role="status"]')).toContainText(/\$[\d,]+\.\d{2}/);
  });

  test("narrows the chart to a range without losing the headline", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "1Y", exact: true }).click();
    await expect(page.getByRole("button", { name: "1Y", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("$1,454.00").first()).toBeVisible();
  });
});
