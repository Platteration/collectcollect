import { expect, test } from "@playwright/test";
import { addCardByHand } from "./helpers";

test("cards can be filed away and found again by where they are kept", async ({ page }) => {
  await addCardByHand(page, { name: "Filed Snorlax", set: "Jungle" });
  await addCardByHand(page, { name: "Filed Onix", set: "Jungle" });
  await addCardByHand(page, { name: "Loose Abra", set: "Jungle" });

  // File two of them together from the collection page.
  await page.goto("/collection?q=Filed");
  await page.getByLabel("Select all").check();
  await page.getByLabel("Kept in", { exact: true }).fill("Binder 2, page 4");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByText(/Filed 2 cards/)).toBeVisible();

  // The location becomes a filter, and offers itself for the next card.
  await page.goto("/collection");
  await page.getByLabel("Kept in").selectOption("Binder 2, page 4");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: /Filed Snorlax/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Loose Abra/ })).toHaveCount(0);

  // Cards still to be put away are their own filter.
  await page.goto("/collection");
  await page.getByLabel("Kept in").selectOption("none");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: /Loose Abra/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Filed Snorlax/ })).toHaveCount(0);

  // And it shows on the card itself.
  await page.goto("/collection?q=Filed+Snorlax");
  await page.getByRole("link", { name: /Filed Snorlax/ }).click();
  await expect(page.getByText("Binder 2, page 4")).toBeVisible();
});
