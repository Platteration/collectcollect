import { expect, test } from "@playwright/test";
import { addCardByHand } from "./helpers";

test("a grading submission runs from draft to a booked outcome", async ({ page }, testInfo) => {
  // A retry runs against the data directory the failed attempt wrote to, and that
  // attempt's card is still in it: under the same name the add flow offers to merge
  // the duplicate instead of saving, so a retry could never pass. Each attempt (and
  // each --repeat-each copy) names its own card and batch.
  const run = `${testInfo.repeatEachIndex}.${testInfo.retry}`;
  const card = `Gradable Dragonite ${run}`;
  const batch = `E2E batch ${run}`;
  await addCardByHand(page, { name: card, set: "Fossil" });

  // Every change to the batch reaches the server half a second late, as it can on a
  // loaded CI runner. A step that waits on something other than the answer then
  // navigates away before the change has landed on every run, not only on a slow
  // one, and the card never reaches the grader.
  await page.route(/\/api\/submissions\/\d+$/, async (route) => {
    if (route.request().method() === "PATCH") await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  await page.goto("/submissions");
  await page.getByRole("button", { name: "New submission" }).click();
  await page.getByLabel("Service level").fill("Value");
  await page.getByLabel("Fee per card").fill("20");
  await page.getByLabel("Shipping total").fill("15");
  await page.getByLabel("Name", { exact: true }).fill(batch);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("heading", { name: batch })).toBeVisible();
  await page.getByPlaceholder("Search your raw cards…").fill(card);
  await page.locator("section", { hasText: "Add raw cards" }).getByRole("button", { name: "Add" }).first().click();
  await expect(page.getByText("$35.00")).toBeVisible(); // 20 fee + 15 shipping

  await page.getByRole("button", { name: "Mark as sent" }).click();
  // The status the answer brings, not a substring: getByText("Sent") matches the
  // "Mark as sent" button itself, which is there before the request has landed.
  await expect(page.getByRole("button", { name: "Mark as sent" })).toHaveCount(0);
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();

  // The card is now at the grader, so its page says so.
  await page.goto(`/collection?q=${encodeURIComponent(card)}`);
  await page.getByRole("link", { name: card }).click();
  await expect(page.getByText("When the card comes back")).toBeVisible();

  await page.goto("/submissions");
  await page.getByRole("link", { name: batch }).click();
  await page.getByPlaceholder("9.5").fill("10");
  await page.getByRole("button", { name: "Record grades" }).click();
  await expect(page.getByText("Returned", { exact: true })).toBeVisible();

  // The graded card now carries the company and grade.
  await page.goto(`/collection?q=${encodeURIComponent(card)}`);
  await page.getByRole("link", { name: card }).click();
  await expect(page.getByText("PSA 10").first()).toBeVisible();
});
