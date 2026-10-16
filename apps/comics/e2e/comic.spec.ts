import { expect, test } from "@playwright/test";

test.describe("one comic", () => {
  test("prices a stack per copy and in total, and keeps each purchase", async ({ page }) => {
    await page.goto("/collection?q=X-Men");
    await page.getByRole("link", { name: /X-Men/ }).click();

    await expect(page.getByRole("heading", { name: "X-Men #1" })).toBeVisible();
    await expect(page.getByText(/\$54\.00 for 3/)).toBeVisible();
    await expect(page.getByText(/paid \$8\.00 each/)).toBeVisible();
    // Two recorded values, so the history is a table and the chart has a line.
    await expect(page.getByRole("heading", { name: "Value over time" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$12.00" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$18.00" })).toBeVisible();
  });

  test("treats a slab as one specific object", async ({ page }) => {
    await page.goto("/collection?q=Amazing+Spider-Man");
    await page.getByRole("link", { name: /Amazing Spider-Man/ }).click();
    await expect(page.getByRole("heading", { name: "The Amazing Spider-Man #300" })).toBeVisible();
    // One object: there is no such thing as another copy of it.
    await expect(page.getByRole("button", { name: "Bought more" })).toHaveCount(0);
    // The cert number is said twice: beside the slab label and as a fact in the record.
    await expect(page.getByText("cert 2036123-004", { exact: true })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /^2036123-004$/ })).toBeVisible();
    await expect(page.getByText("Todd McFarlane cover; 25th anniversary issue.")).toBeVisible();
  });

  test("shows a raw key that nobody has priced as not priced", async ({ page }) => {
    await page.goto("/collection?q=Incredible+Hulk");
    await page.getByRole("link", { name: /Incredible Hulk/ }).click();
    await expect(page.getByRole("heading", { name: "The Incredible Hulk #181" })).toBeVisible();
    // Exactly the figure: the line under it also says "Not priced yet".
    await expect(page.getByText("Not priced", { exact: true })).toBeVisible();
  });

  test("has nothing at an id that is not there", async ({ page }) => {
    const response = await page.goto("/items/99999");
    expect(response?.status()).toBe(404);
  });
});
