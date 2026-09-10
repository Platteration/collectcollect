import { expect, test } from "@playwright/test";

test.describe("the portfolio", () => {
  test("totals the inventory and shows what it is made of", async ({ page }) => {
    await page.goto("/");
    // 1180 + 51 + 34 + 35 × 1.40 + 128 = $1,442.00
    await expect(page.getByText("$1,442.00")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top holdings" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Karambit/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By kind" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By rarity" })).toBeVisible();
  });

  test("does not claim a share of the whole for a grouping that misses part of it", async ({ page }) => {
    await page.goto("/");
    // Cases have no rarity, so the rarity bars cannot add up — and the page has
    // to say so rather than quietly rescaling them to fill the chart.
    await expect(page.getByText(/has no rarity recorded, so these do not add up to the whole/)).toBeVisible();
  });

  test("leaves a copy nobody priced out of the return instead of calling it free", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/arrived without a recorded price/)).toBeVisible();
  });

  test("counts what cannot be traded yet", async ({ page }) => {
    await page.goto("/");
    const locked = page.locator("div").filter({ hasText: /^Trade locked/ }).first();
    await expect(locked).toContainText("cannot be sold yet");
  });

  test("reads the value chart with a keyboard and a screen reader", async ({ page }) => {
    await page.goto("/");
    const chart = page.getByRole("img", { name: /Inventory value over time/ });
    await expect(chart).toBeVisible();
    await chart.focus();
    await page.keyboard.press("ArrowRight");
    // The crosshair is announced, so the tooltip is never the only way to read it.
    await expect(page.locator('[role="status"]')).toContainText(/\$[\d,]+\.\d{2}/);
  });

  test("narrows the chart to a range without losing the headline", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "1Y" }).click();
    await expect(page.getByRole("button", { name: "1Y" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("$1,442.00")).toBeVisible();
  });

  test("shows what was sold and what it actually earned", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sold" })).toBeVisible();
    // Six cases at 55 cents, less 40 cents of fees, less 30 cents each in cost.
    await expect(page.getByText("$3.30")).toBeVisible();
    await expect(page.getByText("$1.10").first()).toBeVisible();
  });
});
