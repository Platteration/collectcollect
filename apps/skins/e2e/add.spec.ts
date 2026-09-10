import { expect, test } from "@playwright/test";

test.describe("adding an item by hand", () => {
  test("reads the kind, the gun, the wear and StatTrak out of the name", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Market hash name").fill("StatTrak™ AWP | Asiimov (Well-Worn)");
    await expect(page.getByText(/Read as Weapon · AWP · Asiimov · Well-Worn · StatTrak™/)).toBeVisible();
    // Filled in, not just described.
    await expect(page.getByLabel("Kind")).toHaveValue("weapon");
    await expect(page.getByLabel("Wear tier")).toHaveValue("well_worn");
  });

  test("lets the float settle the wear tier, and locks the tier while it does", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Market hash name").fill("AK-47 | Redline (Field-Tested)");
    await expect(page.getByLabel("Wear tier")).toBeEnabled();

    await page.getByLabel("Float").fill("0.5");
    await expect(page.getByLabel("Wear tier")).toHaveValue("battle_scarred");
    await expect(page.getByLabel("Wear tier")).toBeDisabled();
    await expect(page.getByText("Decided by the float.")).toBeVisible();
    await expect(page.getByText("Sets the wear tier to Battle-Scarred.")).toBeVisible();
  });

  test("says a float has to be a number between 0 and 1", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Market hash name").fill("AK-47 | Redline (Field-Tested)");
    await page.getByLabel("Float").fill("42");
    await expect(page.getByText("A float is a number between 0 and 1.")).toBeVisible();
    await expect(page.getByLabel("Wear tier")).toBeEnabled();
  });

  test("offers a count for a stack and not for a unique object", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Market hash name").fill("Clutch Case");
    await expect(page.getByLabel("How many")).toBeVisible();
    // A weapon is one object, so a count would be a lie the ledger has to live with.
    await expect(page.getByLabel("Float")).toHaveCount(0);

    await page.getByLabel("Market hash name").fill("AK-47 | Redline (Field-Tested)");
    await expect(page.getByLabel("How many")).toHaveCount(0);
    await expect(page.getByLabel("Float")).toBeVisible();
  });

  test("saves and lands on the item it made", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Market hash name").fill("Desert Eagle | Blaze (Factory New)");
    await page.getByLabel("Float").fill("0.0123456789");
    await page.getByLabel("Pattern seed").fill("640");
    await page.getByLabel("Paid, each").fill("310.50");
    await page.getByLabel("Rarity").selectOption("classified");
    await page.getByRole("button", { name: "Add to inventory" }).click();

    await expect(page).toHaveURL(/\/items\/\d+$/);
    await expect(page.getByRole("heading", { name: "Desert Eagle | Blaze (Factory New)" })).toBeVisible();
    await expect(page.getByText("0.0123456789")).toBeVisible();
    await expect(page.getByText(/Pattern 640/)).toBeVisible();
    await expect(page.getByText(/paid \$310\.50/)).toBeVisible();
    await expect(page.getByText("Classified")).toBeVisible();
  });

  test("leaves a price nobody typed as unknown rather than zero", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel("Market hash name").fill("Chroma 2 Case");
    await page.getByLabel("How many").fill("4");
    await page.getByRole("button", { name: "Add to inventory" }).click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
    // "not recorded", never "$0.00": a case opened out of another case has no
    // price, and calling it free would read as pure profit.
    await expect(page.getByRole("cell", { name: "not recorded" })).toBeVisible();
    await expect(page.getByText(/paid \$0\.00/)).toHaveCount(0);
  });
});
