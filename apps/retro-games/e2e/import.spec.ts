import { expect, test } from "@playwright/test";

const csv = [
  "title,system,region,complete,qty,paid",
  "Super Mario World,Super Nintendo,USA,Complete,2,42",
  "Sonic the Hedgehog,Sega Genesis,USA,Loose,1,15",
  ",Nothing to go on,,,,1,10",
].join("\n");

test.describe("importing a spreadsheet", () => {
  test("shows what it understood before anything is written, then writes it", async ({ page }) => {
    await page.goto("/import");
    await page.getByLabel("Or paste it").fill(csv);
    await page.getByRole("button", { name: "See what it says" }).click();

    // Two of three rows are usable; the third has no title to file it under.
    await expect(page.getByText("of 3 rows can be read")).toBeVisible();
    await expect(page.getByText("system").first()).toBeVisible();
    await expect(page.getByText("No game name in this row")).toBeVisible();

    await page.getByRole("button", { name: /Import 2 rows/ }).click();
    await expect(page.getByText(/added,/)).toBeVisible();

    await page.getByRole("link", { name: "View games" }).click();
    await expect(page.getByRole("link", { name: /Super Mario World/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Sonic the Hedgehog/ })).toBeVisible();
  });

  test("reads the words a spreadsheet uses for a platform and a completeness", async ({ page }) => {
    await page.goto("/collection?q=Sonic+the+Hedgehog");
    await page.getByRole("link", { name: /Sonic the Hedgehog/ }).click();
    // On the game's own page before anything is read: the collection page it leaves also
    // says "Loose" (in its filter and on the tile) and the platform, and would match too.
    await expect(page).toHaveURL(/\/items\/\d+$/);
    // Exactly the line under the title: the breadcrumb above it ends with the same words.
    await expect(page.getByText("Genesis / Mega Drive · NTSC-U", { exact: true })).toBeVisible();
    await expect(page.locator(".badge").filter({ hasText: /^Loose$/ })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /^Loose$/ })).toBeVisible();
  });
});
