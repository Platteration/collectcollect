import { expect, test } from "@playwright/test";

test.describe("color scheme", () => {
  test("changes the accent but never the gain/loss colors, and survives a reload", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "teal");
    const before = await page.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).backgroundColor);

    const violet = page.getByRole("button", { name: "Violet" });
    await violet.click();
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "violet");
    await expect(violet).toHaveAttribute("aria-pressed", "true");

    // Survives a reload, applied before the first paint like the theme is.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "violet");

    const after = await page.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(after).not.toBe(before);

    // The Karambit was priced twice; its chart's up/down color is a fixed
    // token untouched by the scheme, whichever direction it moved.
    await page.goto("/inventory?q=Karambit");
    await page.getByRole("link", { name: /Karambit/ }).click();
    const chart = page.locator("svg[aria-label^='Value of this item over time']").first();
    const stroke = await chart.locator("path[stroke]").first().getAttribute("stroke");
    expect(["var(--chart-good)", "var(--chart-bad)"]).toContain(stroke);
  });
});
