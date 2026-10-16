import { expect, test } from "@playwright/test";

test.describe("the collection", () => {
  test("counts everything held, and values only what is priced", async ({ page }) => {
    await page.goto("/collection");
    // Three rows, five copies: the slab, three raw copies and the unpriced key.
    await expect(page.getByText("5 copies")).toBeVisible();
    await expect(page.getByText("$1,454.00")).toBeVisible();
    await expect(page.getByText("1 not priced")).toBeVisible();
  });

  test("searches across the fields the spec marks as searchable", async ({ page }) => {
    await page.goto("/collection?q=Venom");
    await expect(page.getByRole("link", { name: /Amazing Spider-Man/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /X-Men/ })).toHaveCount(0);
    await page.goto("/collection?q=Marvel");
    await expect(page.getByRole("link", { name: /Amazing Spider-Man/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Incredible Hulk/ })).toBeVisible();
  });

  test("filters on a domain field", async ({ page }) => {
    await page.goto("/collection?f_slabbed=1");
    await expect(page.getByRole("link", { name: /Amazing Spider-Man/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /X-Men/ })).toHaveCount(0);
    await page.goto("/collection?f_gradingCompany=cbcs");
    // The only CBCS book was sold, so nothing held carries that grade.
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
    await page.goto("/collection?f_gradingCompany=cgc");
    await expect(page.getByRole("link", { name: /Amazing Spider-Man/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Incredible Hulk/ })).toHaveCount(0);
  });

  test("hides what was sold until asked", async ({ page }) => {
    await page.goto("/collection");
    await expect(page.getByRole("link", { name: /Saga/ })).toHaveCount(0);
    await page.goto("/collection?sold=1");
    await expect(page.getByRole("link", { name: /Saga/ })).toBeVisible();
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await page.goto("/collection?q=nothing-is-called-this");
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
  });
});
