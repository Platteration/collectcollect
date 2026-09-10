import { expect, test } from "@playwright/test";
import { addCardByHand } from "./helpers";

/**
 * The checklist fetch happens on the server, so a browser route cannot stand in
 * for the card API the way it does for identification. What that leaves worth
 * checking here is the page itself: which sets it derives from the collection,
 * which games it will not promise a checklist for, and that a failed fetch says
 * so rather than silently doing nothing. The providers, the number-then-name
 * matching and the completion arithmetic are covered in tests/sets.test.ts
 * against recorded responses.
 */
test("the sets page lists what the collection touches and is honest about sources", async ({ page }) => {
  await addCardByHand(page, { name: "Setpage Alakazam", set: "Setpage Base", number: "1/102" });
  await addCardByHand(page, { name: "Setpage Chansey", set: "Setpage Base", number: "3/102" });
  await addCardByHand(page, { name: "Setpage Trout", game: "sports", set: "Setpage Topps" });

  await page.goto("/sets");
  const pokemonSet = page.locator("li", { hasText: "Setpage Base" }).first();
  await expect(pokemonSet.getByText("you have 2 cards")).toBeVisible();
  await expect(pokemonSet.getByText("No checklist yet")).toBeVisible();
  await expect(pokemonSet.getByRole("button", { name: "Fetch checklist" })).toBeVisible();

  // A sports set has no checklist source, so no button is offered at all.
  const sportsSet = page.locator("li", { hasText: "Setpage Topps" }).first();
  await expect(sportsSet.getByText("No checklist source for this game")).toBeVisible();
  await expect(sportsSet.getByRole("button", { name: "Fetch checklist" })).toHaveCount(0);

  // A fetch that cannot reach the source reports why instead of failing quietly.
  await page.route("**/api/sets/refresh", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Could not fetch that checklist: network unreachable" }) }),
  );
  await pokemonSet.getByRole("button", { name: "Fetch checklist" }).click();
  await expect(pokemonSet.getByText(/network unreachable/)).toBeVisible();

  // The set's own page works before any checklist exists.
  await pokemonSet.getByRole("link", { name: "Setpage Base" }).click();
  await expect(page.getByRole("heading", { name: "Setpage Base" })).toBeVisible();
  await expect(page.getByText("no checklist fetched yet")).toBeVisible();
  await expect(page.getByRole("link", { name: /Setpage Alakazam/ })).toBeVisible();
});
