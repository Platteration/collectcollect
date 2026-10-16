import { expect, test } from "@playwright/test";

test.describe("the portfolio", () => {
  test("totals the sealed bottles and shows what they are made of", async ({ page }) => {
    await page.goto("/");
    // Three Springbanks at $100 and one Port Ellen at $2,000.
    await expect(page.getByText("$2,300.00").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top holdings" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Port Ellen/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By region" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By distillery" })).toBeVisible();
  });

  test("counts the copies rather than the rows, and says how many are priced", async ({ page }) => {
    await page.goto("/");
    // Three counted rows, five copies between them; the open bottle is neither.
    await expect(page.getByText("5 copies")).toBeVisible();
    await expect(page.getByText("2 of 3")).toBeVisible();
    await expect(page.getByText("the rest are unvalued")).toBeVisible();
  });

  test("leaves the open bottle out of the total, whatever it is priced at", async ({ page }) => {
    await page.goto("/");
    // The open bottle carries a recorded price of $500, which must not reach
    // the total — it is worth what it was worth the day it was opened, and
    // that figure is not an investment any more.
    await expect(page.getByText("$2,800.00")).toHaveCount(0);
    await expect(page.getByText(/1 open and left out of the total/)).toBeVisible();
  });

  test("leaves a bottle nobody priced out of the return instead of calling it free", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/1 bought but not yet priced/)).toBeVisible();
  });

  test("separates what is only on paper from what was actually banked", async ({ page }) => {
    await page.goto("/");
    // Unrealised: $2,300 against $1,125 paid for the copies that have both.
    await expect(page.getByText("$1,175.00")).toBeVisible();
    await expect(page.getByText(/\+104\.4% on \$1,125\.00/)).toBeVisible();
    // Realised: $300 less $10 of fees less the $95 it cost.
    await expect(page.getByText("$195.00").first()).toBeVisible();
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
