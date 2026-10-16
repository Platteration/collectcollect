import { expect, test } from "@playwright/test";

test.describe("the collection", () => {
  test("counts everything held, and values only what counts", async ({ page }) => {
    await page.goto("/collection");
    // Three rows, five copies: three Mario 64s, the graded Zelda and Chrono Trigger.
    await expect(page.getByText("5 copies")).toBeVisible();
    await expect(page.getByText("$2,300.00")).toBeVisible();
    await expect(page.getByText("1 not priced")).toBeVisible();
  });

  test("searches across the fields the spec marks as searchable", async ({ page }) => {
    await page.goto("/collection?q=Ocarina");
    await expect(page.getByRole("link", { name: /Ocarina of Time/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Super Mario 64/ })).toHaveCount(0);
  });

  test("filters on a domain field", async ({ page }) => {
    await page.goto("/collection?f_platform=n64");
    await expect(page.getByRole("link", { name: /Super Mario 64/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Ocarina of Time/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Chrono Trigger/ })).toHaveCount(0);
  });

  test("filters on completeness, down to the graded copy on its own", async ({ page }) => {
    await page.goto("/collection?f_completeness=graded");
    await expect(page.getByRole("link", { name: /Ocarina of Time/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Super Mario 64/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Chrono Trigger/ })).toHaveCount(0);
  });

  test("hides what was sold until asked", async ({ page }) => {
    await page.goto("/collection");
    await expect(page.getByRole("link", { name: /EarthBound/ })).toHaveCount(0);
    await page.goto("/collection?sold=1");
    await expect(page.getByRole("link", { name: /EarthBound/ })).toBeVisible();
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await page.goto("/collection?q=nothing-is-called-this");
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
  });
});
