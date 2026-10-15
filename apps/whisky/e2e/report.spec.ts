import { expect, test } from "@playwright/test";

test.describe("the appraisal report", () => {
  test("values everything held and says what it left out", async ({ page }) => {
    await page.goto("/report");
    await expect(page.getByRole("heading", { name: "Whisky collection valuation" })).toBeVisible();
    await expect(page.getByText("6 copies")).toBeVisible();
    await expect(page.getByText("$2,300.00").first()).toBeVisible();
    await expect(page.getByText("1 unpriced, not counted")).toBeVisible();
    await expect(page.getByText(/1 is not priced and left out of the total/)).toBeVisible();
  });

  test("lists an open bottle at its frozen value, in brackets, and not in the total", async ({ page }) => {
    await page.goto("/report");
    const row = page.getByRole("row", { name: /Lagavulin/ });
    await expect(row).toContainText("($80.00)");
    await expect(row).toContainText("not counted");
    await expect(page.getByText(/1 set aside: open and left out of the total/)).toBeVisible();
  });

  test("carries the columns only whisky has", async ({ page }) => {
    await page.goto("/report");
    await expect(page.getByRole("columnheader", { name: "Fill" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Bottle / batch" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Port Ellen/ })).toContainText("Bottle 2417 of 5400");
    await expect(page.getByRole("row", { name: /Springbank/ })).toContainText("sealed");
  });

  test("accounts for what was sold", async ({ page }) => {
    await page.goto("/report");
    await expect(page.getByRole("heading", { name: "Sold to date" })).toBeVisible();
    await expect(page.getByText(/a realised \$195\.00/)).toBeVisible();
  });

  test("adds photos only when asked, and offers no private switch when nothing is private", async ({ page }) => {
    await page.goto("/report");
    // Nothing on a bottle is private, so the switch that would reveal it is not offered.
    await expect(page.getByRole("link", { name: "Include private details" })).toHaveCount(0);
    await page.getByRole("link", { name: "Include photos" }).click();
    await expect(page).toHaveURL(/photos=1/);
    await expect(page.getByRole("columnheader", { name: "Photo" })).toBeVisible();
  });
});
