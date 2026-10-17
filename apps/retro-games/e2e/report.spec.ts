import { expect, test } from "./fixtures";

test.describe("the appraisal report", () => {
  test("values everything held and says what it left out", async ({ page }) => {
    await page.goto("/report");
    await expect(page.getByRole("heading", { name: "Retro game collection valuation" })).toBeVisible();
    await expect(page.getByText("5 copies")).toBeVisible();
    await expect(page.getByText("$2,300.00").first()).toBeVisible();
    await expect(page.getByText("1 unpriced, not counted")).toBeVisible();
    await expect(page.getByText(/1 is not priced and left out of the total/)).toBeVisible();
  });

  test("carries the columns only games have", async ({ page }) => {
    await page.goto("/report");
    await expect(page.getByRole("columnheader", { name: "Platform" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Cert" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Ocarina of Time/ })).toContainText("0921347001");
    await expect(page.getByRole("row", { name: /Super Mario 64/ })).toContainText("Nintendo 64");
  });

  test("accounts for what was sold", async ({ page }) => {
    await page.goto("/report");
    await expect(page.getByRole("heading", { name: "Sold to date" })).toBeVisible();
    await expect(page.getByText(/a realised \$275\.00/)).toBeVisible();
  });

  test("adds photos only when asked, and offers no private switch when nothing is private", async ({ page }) => {
    await page.goto("/report");
    // Nothing on a game is private, so the switch that would reveal it is not offered.
    await expect(page.getByRole("link", { name: "Include private details" })).toHaveCount(0);
    await page.getByRole("link", { name: "Include photos" }).click();
    await expect(page).toHaveURL(/photos=1/);
    await expect(page.getByRole("columnheader", { name: "Photo" })).toBeVisible();
  });
});
