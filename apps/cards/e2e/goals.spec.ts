import { expect, test } from "@playwright/test";

test("a wanted card has its own budget, prefilled acquisition and live collection progress", async ({ page }) => {
  await page.goto("/goals");
  await page.getByLabel("Goal name", { exact: true }).fill("E2E childhood favorites");
  await page.getByLabel("Budget for remaining cards (USD)").fill("50");
  await page.getByRole("button", { name: "Create goal", exact: true }).click();
  const goal = page.getByRole("region", { name: "E2E childhood favorites" });
  await expect(goal).toBeVisible();
  await goal.getByText("Add a wanted card", { exact: true }).click();
  await goal.getByLabel("Card name", { exact: true }).fill("E2E wanted Pikachu");
  await goal.getByLabel("Set name", { exact: true }).fill("E2E goal set");
  await goal.getByLabel("Collector number").fill("58");
  await goal.getByLabel("Price ceiling per copy (USD)").fill("12");
  await goal.getByRole("button", { name: "Add wanted card", exact: true }).click();
  await expect(goal.getByText("0 of 1 copies owned · 0%")).toBeVisible();
  await expect(goal.getByText("$12.00", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(goal.getByRole("button", { name: "Archive goal" })).toBeEnabled();
  await expect(goal.getByRole("link", { name: "Add acquired card" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await goal.screenshot({ path: "test-results/goal-mobile-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(goal.getByRole("link", { name: "Add acquired card" })).toHaveCSS("color", "rgb(247, 241, 229)");
  await goal.screenshot({ path: "test-results/goal-mobile-dark.png" });
  await goal.getByRole("link", { name: "Add acquired card" }).click();
  await expect(page.getByLabel("Card name", { exact: true })).toHaveValue("E2E wanted Pikachu");
  // Use the same collection API as the normal form to isolate goals from
  // unrelated price-provider availability; the prefilled form was verified.
  const created = await page.request.post("/api/cards", { data: { game: "pokemon", name: "E2E wanted Pikachu", setName: "E2E goal set", cardNumber: "58", quantity: 1 } });
  expect(created.ok()).toBe(true);
  await page.goto("/goals");
  await expect(goal.getByText("1 of 1 copies owned · 100%")).toBeVisible();
  await expect(goal.getByRole("link", { name: "Add acquired card" })).toHaveCount(0);
  await goal.getByRole("button", { name: "Archive goal" }).click();
  await expect(goal).toHaveCount(0);
  await page.getByLabel("Show archived goals").check();
  await expect(goal).toBeVisible();
});
