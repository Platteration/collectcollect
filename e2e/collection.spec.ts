import { expect, test } from "@playwright/test";
import { addCardByHand, stubPrices } from "./helpers";

test.describe("adding and viewing cards", () => {
  test("a card added by hand appears in the collection and on its own page", async ({ page }) => {
    await addCardByHand(page, { name: "Machamp", set: "Base Set", number: "8/102", purchase: "12" });

    await page.goto("/collection");
    await expect(page.getByRole("link", { name: /Machamp/ })).toBeVisible();
    await expect(page.getByText("Base Set · #8/102")).toBeVisible();

    await page.getByRole("link", { name: /Machamp/ }).click();
    await expect(page.getByRole("heading", { name: "Machamp" })).toBeVisible();
    await expect(page.getByText("$12.00")).toBeVisible();
  });

  test("a card matching one already owned offers to become another copy", async ({ page }) => {
    await addCardByHand(page, { name: "Alakazam", set: "Base Set", number: "1/102" });

    await page.goto("/add");
    await page.getByRole("button", { name: "Enter a card manually" }).click();
    const form = page.locator("fieldset").first();
    await form.getByLabel("Card name").fill("Alakazam");
    await form.getByLabel("Set / product").fill("Base Set");
    await form.getByLabel("Card number").fill("1/102");
    await page.getByRole("button", { name: "Save to collection" }).click();

    await expect(page.getByText("Looks like you already have this card")).toBeVisible();
    await page.getByRole("button", { name: "Add as another copy" }).click();
    await expect(page.getByText(/Saved/).first()).toBeVisible();

    await page.goto("/collection");
    await expect(page.getByText("×2")).toBeVisible();
  });

  test("prices can be looked up before a card is saved", async ({ page }) => {
    await stubPrices(page, { ungraded: 40, psa10: 300 });
    await page.goto("/add");
    await page.getByRole("button", { name: "Enter a card manually" }).click();
    await page.locator("fieldset").first().getByLabel("Card name").fill("Gyarados");
    await page.getByRole("button", { name: "Look up prices" }).click();
    await expect(page.getByText("$40.00").first()).toBeVisible();
    await expect(page.getByText("PSA 10").first()).toBeVisible();
  });
});
