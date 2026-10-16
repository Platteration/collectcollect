import { expect, test } from "@playwright/test";

test.describe("the portfolio", () => {
  test("totals the priced games and shows what they are made of", async ({ page }) => {
    await page.goto("/");
    // Three Mario 64s at $100 and one graded Zelda at $2,000.
    await expect(page.getByText("$2,300.00").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top holdings" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Ocarina of Time/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By platform" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By completeness" })).toBeVisible();
  });

  test("counts the copies rather than the rows, and says how many are priced", async ({ page }) => {
    await page.goto("/");
    // Three held rows, five copies between them.
    await expect(page.getByText("5 copies")).toBeVisible();
    await expect(page.getByText("2 of 3")).toBeVisible();
    await expect(page.getByText("the rest are unvalued")).toBeVisible();
  });

  test("leaves a game nobody priced out of the return instead of calling it free", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/1 bought but not yet priced/)).toBeVisible();
  });

  test("separates what is only on paper from what was actually banked", async ({ page }) => {
    await page.goto("/");
    // Unrealised: $2,300 against $935 paid for the copies that have both.
    await expect(page.getByText("$1,365.00")).toBeVisible();
    await expect(page.getByText(/\+146\.0% on \$935\.00/)).toBeVisible();
    // Realised: $900 less $25 of fees less the $600 it cost.
    await expect(page.getByText("$275.00").first()).toBeVisible();
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
    await expect(page.getByText("$2,300.00").first()).toBeVisible();
  });
});
