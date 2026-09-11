import { expect, test } from "@playwright/test";

test.describe("one bottle", () => {
  test("prices a stack per copy and in total, and keeps each purchase", async ({ page }) => {
    await page.goto("/collection?q=Springbank");
    await page.getByRole("link", { name: /Springbank/ }).click();

    await expect(page.getByRole("heading", { name: "Springbank 10 Year Old" })).toBeVisible();
    await expect(page.getByText("10 yo · 46% · Campbeltown", { exact: true })).toBeVisible();
    await expect(page.getByText("Sealed · Box")).toBeVisible();
    await expect(page.getByText(/\$300\.00 for 3/)).toBeVisible();
    await expect(page.getByText(/paid \$75\.00 each/)).toBeVisible();
    // Two recorded values, so the history is a table and the chart has a line.
    await expect(page.getByRole("heading", { name: "Value over time" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$90.00" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$100.00" })).toBeVisible();
  });

  test("offers to open a sealed bottle, and to record another purchase of a stack", async ({ page }) => {
    await page.goto("/collection?q=Springbank");
    await page.getByRole("link", { name: /Springbank/ }).click();
    await expect(page.getByRole("button", { name: "Open a bottle" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bought more" })).toBeVisible();
  });

  test("treats a numbered bottle as one specific object", async ({ page }) => {
    await page.goto("/collection?q=Port+Ellen");
    await page.getByRole("link", { name: /Port Ellen/ }).click();
    await expect(page.getByRole("heading", { name: "Port Ellen 1979 Annual Release" })).toBeVisible();
    // One object: there is no such thing as another copy of it.
    await expect(page.getByRole("button", { name: "Bought more" })).toHaveCount(0);
    await expect(page.getByText("Bottle 2417 of 5400")).toBeVisible();
    await expect(page.getByText("Closed distillery. Capsule perfect.")).toBeVisible();
  });

  test("shows an open bottle as frozen, and says it is not counted", async ({ page }) => {
    await page.goto("/collection?f_sealed=0");
    await page.getByRole("link", { name: /Lagavulin/ }).click();
    await expect(page.getByText("Open since 2025-12-25 · 60% left")).toBeVisible();
    await expect(page.getByText("Frozen when opened on 2025-12-25")).toBeVisible();
    await expect(page.getByText(/not counted in the portfolio total/)).toBeVisible();
    await expect(page.getByText(/Frozen at \$80\.00 when it was opened/)).toBeVisible();
    // Opening it is not on offer twice.
    await expect(page.getByRole("button", { name: "Open a bottle" })).toHaveCount(0);
  });

  test("has nothing at an id that is not there", async ({ page }) => {
    const response = await page.goto("/items/99999");
    expect(response?.status()).toBe(404);
  });
});
