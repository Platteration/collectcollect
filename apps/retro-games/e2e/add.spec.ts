import { expect, test } from "./fixtures";

test.describe("adding a game by hand", () => {
  test("saves what was typed and opens it", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Title").fill("Castlevania: Symphony of the Night");
    await page.getByLabel("Platform").selectOption("ps1");
    await page.getByLabel("Release year").fill("1997");
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Paid, each (USD)").fill("90");
    await page.getByRole("button", { name: "Save game" }).click();

    await expect(page.getByText(/Saved Castlevania: Symphony of the Night to your games/)).toBeVisible();
    await page.getByRole("link", { name: "Open it" }).click();
    await expect(page.getByRole("heading", { name: "Castlevania: Symphony of the Night" })).toBeVisible();
    await expect(page.getByText(/paid \$90\.00 each/)).toBeVisible();
    // A game arrives loose unless said otherwise, and loose copies stack.
    // Said twice: the condition badge under the title and the Completeness fact in the record.
    await expect(page.locator(".badge").filter({ hasText: /^Loose$/ })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /^Loose$/ })).toBeVisible();
  });

  test("takes a second identical game as another copy rather than a second row", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Title").fill("Tetris");
    await page.getByLabel("Platform").selectOption("game_boy");
    await page.getByRole("button", { name: "Save game" }).click();
    await expect(page.getByText(/Saved Tetris to your games/)).toBeVisible();

    await page.goto("/add");
    await page.getByLabel("Title").fill("Tetris");
    await page.getByLabel("Platform").selectOption("game_boy");
    await page.getByRole("button", { name: "Save game" }).click();
    await expect(page.getByText(/Added as another copy of Tetris/)).toBeVisible();
  });

  test("refuses a game with no platform rather than saving half of one", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Title").fill("Nameless");
    await page.getByRole("button", { name: "Save game" }).click();
    await expect(page.getByText(/Platform is required/)).toBeVisible();
  });
});
