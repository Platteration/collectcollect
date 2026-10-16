import { expect, test } from "@playwright/test";

test.describe("adding a comic by hand", () => {
  test("saves what was typed and opens it", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Title / series").fill("Saga");
    await page.getByLabel("Issue").fill("2");
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Paid, each (USD)").fill("12");
    await page.getByRole("button", { name: "Save comic" }).click();

    await expect(page.getByText(/Saved Saga to your comics/)).toBeVisible();
    await page.getByRole("link", { name: "Open it" }).click();
    await expect(page.getByRole("heading", { name: "Saga #2" })).toBeVisible();
    await expect(page.getByText(/paid \$12\.00 each/)).toBeVisible();
  });

  test("takes a second identical raw comic as another copy rather than a second row", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Title / series").fill("Batman");
    await page.getByLabel("Issue").fill("500");
    await page.getByRole("button", { name: "Save comic" }).click();
    await expect(page.getByText(/Saved Batman to your comics/)).toBeVisible();

    await page.goto("/add");
    await page.getByLabel("Title / series").fill("Batman");
    await page.getByLabel("Issue").fill("500");
    await page.getByRole("button", { name: "Save comic" }).click();
    await expect(page.getByText(/Added as another copy of Batman/)).toBeVisible();
  });

  test("refuses a comic with no issue number rather than saving half of one", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Title / series").fill("Nameless");
    await page.getByRole("button", { name: "Save comic" }).click();
    await expect(page.getByText(/Issue is required/)).toBeVisible();
  });
});
