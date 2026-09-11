import { expect, test } from "@playwright/test";

test.describe("the collection", () => {
  test("counts everything held, and values only what counts", async ({ page }) => {
    await page.goto("/collection");
    // Four rows, six copies, but the open one is not part of the worth.
    await expect(page.getByText("6 copies")).toBeVisible();
    await expect(page.getByText("$2,300.00")).toBeVisible();
    await expect(page.getByText("1 not priced")).toBeVisible();
  });

  test("searches across the fields the spec marks as searchable", async ({ page }) => {
    await page.goto("/collection?q=Port+Ellen");
    await expect(page.getByRole("link", { name: /Port Ellen/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Springbank/ })).toHaveCount(0);
  });

  test("filters on a domain field", async ({ page }) => {
    await page.goto("/collection?f_region=islay");
    await expect(page.getByRole("link", { name: /Port Ellen/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Lagavulin/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Springbank/ })).toHaveCount(0);
  });

  test("marks the open bottle as not counted, in a grid that still shows it", async ({ page }) => {
    await page.goto("/collection?f_sealed=0");
    const tile = page.getByRole("link", { name: /Lagavulin/ });
    await expect(tile).toBeVisible();
    await expect(tile).toContainText("not counted");
    await expect(tile).toContainText("Open · 60% left");
  });

  test("hides what was sold until asked", async ({ page }) => {
    await page.goto("/collection");
    await expect(page.getByRole("link", { name: /Yamazaki/ })).toHaveCount(0);
    await page.goto("/collection?sold=1");
    await expect(page.getByRole("link", { name: /Yamazaki/ })).toBeVisible();
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await page.goto("/collection?q=nothing-is-called-this");
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
  });
});
