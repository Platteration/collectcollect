import { expect, test } from "@playwright/test";
import { addCardByHand } from "./helpers";

test("cards can be selected and acted on together", async ({ page }) => {
  await addCardByHand(page, { name: "Bulk One", set: "Neo Genesis" });
  await addCardByHand(page, { name: "Bulk Two", set: "Neo Genesis" });
  await addCardByHand(page, { name: "Bulk Three", set: "Neo Genesis" });

  await page.goto("/collection?q=Bulk");
  await expect(page.getByRole("link", { name: /Bulk One/ })).toBeVisible();

  // Selecting two of the three offers the bulk toolbar.
  await page.getByLabel("Select Bulk One").check();
  await page.getByLabel("Select Bulk Two").check();
  await expect(page.getByText("2 selected")).toBeVisible();

  await page.getByLabel("Set grading plan").selectOption("planned");
  await expect(page.getByText(/Updated 2 cards/)).toBeVisible();

  await page.goto("/collection?q=Bulk+One");
  await page.getByRole("link", { name: /Bulk One/ }).click();
  await expect(page.getByRole("button", { name: "Plan to grade" })).toHaveAttribute("aria-pressed", "true");

  // Select-all then delete clears the filtered set.
  await page.goto("/collection?q=Bulk");
  await page.getByLabel("Select all").check();
  await expect(page.getByText("3 selected")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  // Removing the last match swaps the grid for the empty state, so the outcome
  // is what to assert on rather than the transient progress line.
  await expect(page.getByRole("link", { name: /Bulk One/ })).toHaveCount(0);
  await expect(page.getByText("No cards yet")).toBeVisible();
});

test("a backup downloads as a readable archive", async ({ page }) => {
  await addCardByHand(page, { name: "Archived Umbreon", set: "Neo Discovery" });
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download backup" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^collectcollect-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = await download.path();
  expect(path).toBeTruthy();
});
