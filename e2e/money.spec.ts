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

test("a second copy keeps its own price, and the older one is sold first", async ({ page }) => {
  // Bought once cheaply, once dearly. What each copy cost has to survive both
  // the second purchase and the sale.
  await addCardByHand(page, { name: "Lotted Lapras", set: "Fossil", number: "25/62", purchase: "10" });

  await page.goto("/add");
  await page.getByRole("button", { name: "Enter a card manually" }).click();
  const form = page.locator("fieldset").first();
  await form.getByLabel("Card name").fill("Lotted Lapras");
  await form.getByLabel("Set / product").fill("Fossil");
  await form.getByLabel("Card number").fill("25/62");
  await form.getByLabel("Purchase price (USD)").fill("100");
  await page.getByRole("button", { name: "Save to collection" }).click();
  await expect(page.getByText("Looks like you already have this card")).toBeVisible();
  await page.getByRole("button", { name: "Add as another copy" }).click();
  await expect(page.getByText(/Saved/).first()).toBeVisible();

  await page.goto("/collection?q=Lotted");
  await page.getByRole("link", { name: /Lotted Lapras/ }).click();

  // Both purchases are recorded at what they actually cost.
  await expect(page.getByText("$10.00 each")).toBeVisible();
  await expect(page.getByText("$100.00 each")).toBeVisible();

  await page.getByRole("button", { name: "Log a sale" }).click();
  await page.getByLabel("Price each (USD)").fill("60");
  await page.getByRole("button", { name: "Record sale" }).click();

  // The copy held longest goes first, so the gain is against $10, not against
  // $100 and not against a $55 average.
  await expect(page.getByText("+$50.00")).toBeVisible();
  // ...and the $10 purchase is the one that emptied.
  await expect(page.locator("li", { hasText: "$10.00 each" })).toContainText("all gone");
  await expect(page.locator("li", { hasText: "$100.00 each" })).not.toContainText("all gone");
});
