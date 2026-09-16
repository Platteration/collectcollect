import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("a wanted card has its own budget, prefilled acquisition and live collection progress", async ({ page }) => {
  // A failed attempt can leave records in the shared server until teardown.
  const suffix = randomUUID().slice(0, 8);
  const goalName = `E2E childhood favorites ${suffix}`;
  const cardName = `E2E wanted Pikachu ${suffix}`;
  let goalId: string | undefined;
  let cardId: number | undefined;
  try {
    await page.goto("/goals");
    const newGoal = page.locator("form").filter({ has: page.getByRole("button", { name: "Create goal", exact: true }) });
    await newGoal.getByLabel("Goal name", { exact: true }).fill(goalName);
    await newGoal.getByLabel("Budget for remaining cards (USD)").fill("50");
    const [goalCreated] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/goals" && response.request().method() === "POST"),
      newGoal.getByRole("button", { name: "Create goal", exact: true }).click(),
    ]);
    expect(goalCreated.ok()).toBe(true);
    goalId = ((await goalCreated.json()) as { goal: { id: string } }).goal.id;
    const goal = page.getByRole("region", { name: goalName, exact: true });
    await expect(goal).toBeVisible();
    await goal.getByText("Add a wanted card", { exact: true }).click();
    const wanted = goal.locator("form").filter({ has: page.getByRole("button", { name: "Add wanted card", exact: true }) });
    await wanted.getByLabel("Card name", { exact: true }).fill(cardName);
    await wanted.getByLabel("Set name", { exact: true }).fill("E2E goal set");
    await wanted.getByLabel("Collector number").fill("58");
    await wanted.getByLabel("Price ceiling per copy (USD)").fill("12");
    await wanted.getByRole("button", { name: "Add wanted card", exact: true }).click();
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
    await expect(page).toHaveURL(/\/add\?goalItem=[a-f0-9-]+$/);
    const acquisition = page.locator(".card-surface").filter({ has: page.getByRole("button", { name: "Save to collection", exact: true }) });
    await expect(acquisition.getByLabel("Card name", { exact: true })).toHaveValue(cardName);
    // Use the same collection API as the normal form to isolate goals from
    // unrelated price-provider availability; the prefilled form was verified.
    const created = await page.request.post("/api/cards", { data: { game: "pokemon", name: cardName, setName: "E2E goal set", cardNumber: "58", quantity: 1 } });
    expect(created.ok()).toBe(true);
    cardId = ((await created.json()) as { card: { id: number } }).card.id;
    await page.goto("/goals");
    await expect(goal.getByText("1 of 1 copies owned · 100%")).toBeVisible();
    await expect(goal.getByRole("link", { name: "Add acquired card" })).toHaveCount(0);
    await goal.getByRole("button", { name: "Archive goal" }).click();
    await expect(goal).toHaveCount(0);
    await page.getByLabel("Show archived goals").check();
    await expect(goal).toBeVisible();
  } finally {
    const deleted = await Promise.all([
      ...(cardId === undefined ? [] : [page.request.delete(`/api/cards/${cardId}`)]),
      ...(goalId === undefined ? [] : [page.request.delete(`/api/goals/${goalId}`)]),
    ]);
    for (const response of deleted) expect(response.ok()).toBe(true);
  }
});
