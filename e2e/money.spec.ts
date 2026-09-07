import { expect, test } from "@playwright/test";
import { addCardByHand } from "./helpers";

test("a sale removes the copy and books a realized gain", async ({ page }) => {
  await addCardByHand(page, { name: "Sellable Zapdos", set: "Fossil", purchase: "100", quantity: "2" });

  await page.goto("/collection?q=Sellable");
  await page.getByRole("link", { name: /Sellable Zapdos/ }).click();

  await page.getByRole("button", { name: "Log a sale" }).click();
  await page.getByLabel("Price each (USD)").fill("180");
  await page.getByLabel("Fees total").fill("20");
  await page.getByLabel("Where").fill("eBay");
  await page.getByRole("button", { name: "Record sale" }).click();

  // 180 sale less 20 fees = 160 net, against a 100 cost basis.
  await expect(page.getByText("$160.00")).toBeVisible();
  await expect(page.getByText("+$60.00")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: /^1$/ }).first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByText(/Realized/)).toBeVisible();
  await expect(page.getByText(/from 1 copy sold for \$180\.00/)).toBeVisible();
});

test("an undone sale puts the copy back", async ({ page }) => {
  await addCardByHand(page, { name: "Returnable Ditto", set: "Fossil", quantity: "1" });
  await page.goto("/collection?q=Returnable");
  await page.getByRole("link", { name: /Returnable Ditto/ }).click();

  await page.getByRole("button", { name: "Log a sale" }).click();
  await page.getByLabel("Price each (USD)").fill("25");
  await page.getByRole("button", { name: "Record sale" }).click();
  await expect(page.getByText("Sold")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Sold")).toHaveCount(0);
});
