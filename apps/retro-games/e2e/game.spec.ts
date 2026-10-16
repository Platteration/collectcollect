import { expect, test } from "@playwright/test";

test.describe("one game", () => {
  test("prices a stack per copy and in total, and keeps each purchase", async ({ page }) => {
    await page.goto("/collection?q=Super+Mario+64");
    await page.getByRole("link", { name: /Super Mario 64/ }).click();

    await expect(page.getByRole("heading", { name: "Super Mario 64" })).toBeVisible();
    await expect(page.getByText("Nintendo 64 · NTSC-U · 1996", { exact: true })).toBeVisible();
    await expect(page.getByText("Complete in box")).toBeVisible();
    await expect(page.getByText(/\$300\.00 for 3/)).toBeVisible();
    await expect(page.getByText(/paid \$45\.00 each/)).toBeVisible();
    // Two recorded values, so the history is a table and the chart has a line.
    await expect(page.getByRole("heading", { name: "Value over time" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$90.00" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$100.00" })).toBeVisible();
  });

  test("offers to record another purchase of a stack", async ({ page }) => {
    await page.goto("/collection?q=Super+Mario+64");
    await page.getByRole("link", { name: /Super Mario 64/ }).click();
    await expect(page.getByRole("button", { name: "Bought more" })).toBeVisible();
  });

  test("treats a graded copy as one specific object", async ({ page }) => {
    await page.goto("/collection?q=Ocarina");
    await page.getByRole("link", { name: /Ocarina of Time/ }).click();
    await expect(page.getByRole("heading", { name: "The Legend of Zelda: Ocarina of Time" })).toBeVisible();
    // One object: there is no such thing as another copy of it.
    await expect(page.getByRole("button", { name: "Bought more" })).toHaveCount(0);
    await expect(page.getByText("WATA 9.4 A+")).toBeVisible();
    await expect(page.getByText(/0921347001/)).toBeVisible();
    await expect(page.getByText("Gold cartridge, first print.")).toBeVisible();
  });

  test("shows a game nobody has priced as not priced", async ({ page }) => {
    await page.goto("/collection?q=Chrono+Trigger");
    await page.getByRole("link", { name: /Chrono Trigger/ }).click();
    await expect(page.getByRole("heading", { name: "Chrono Trigger" })).toBeVisible();
    await expect(page.getByText("Not priced")).toBeVisible();
  });

  test("has nothing at an id that is not there", async ({ page }) => {
    const response = await page.goto("/items/99999");
    expect(response?.status()).toBe(404);
  });
});
