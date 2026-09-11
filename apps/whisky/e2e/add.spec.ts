import { expect, test } from "@playwright/test";

test.describe("adding a bottle by hand", () => {
  test("saves what was typed and opens it", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Distillery / brand").fill("GlenDronach");
    await page.getByLabel("Expression").fill("15 Year Old Revival");
    await page.getByLabel("Age statement, years").fill("15");
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Paid, each (USD)").fill("90");
    await page.getByRole("button", { name: "Save bottle" }).click();

    await expect(page.getByText(/Saved GlenDronach to your bottles/)).toBeVisible();
    await page.getByRole("link", { name: "Open it" }).click();
    await expect(page.getByRole("heading", { name: "GlenDronach 15 Year Old Revival" })).toBeVisible();
    await expect(page.getByText("×2")).toBeVisible();
    await expect(page.getByText(/paid \$90\.00 each/)).toBeVisible();
    // A bottle arrives sealed unless said otherwise, and sealed bottles stack.
    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
  });

  test("takes a second identical bottle as another copy rather than a second row", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Distillery / brand").fill("Highland Park");
    await page.getByLabel("Expression").fill("12 Year Old Viking Honour");
    await page.getByRole("button", { name: "Save bottle" }).click();
    await expect(page.getByText(/Saved Highland Park to your bottles/)).toBeVisible();

    await page.goto("/add");
    await page.getByLabel("Distillery / brand").fill("Highland Park");
    await page.getByLabel("Expression").fill("12 Year Old Viking Honour");
    await page.getByRole("button", { name: "Save bottle" }).click();
    await expect(page.getByText(/Added as another copy of Highland Park/)).toBeVisible();
  });

  test("refuses a bottle with no expression rather than saving half of one", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Distillery / brand").fill("Nameless");
    await page.getByRole("button", { name: "Save bottle" }).click();
    await expect(page.getByText(/Expression is required/)).toBeVisible();
  });
});
