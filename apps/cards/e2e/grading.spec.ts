import { expect, test } from "@playwright/test";
import { addCardByHand } from "./helpers";

test("a grading submission runs from draft to a booked outcome", async ({ page }) => {
  await addCardByHand(page, { name: "Gradable Dragonite", set: "Fossil" });

  await page.goto("/submissions");
  await page.getByRole("button", { name: "New submission" }).click();
  await page.getByLabel("Service level").fill("Value");
  await page.getByLabel("Fee per card").fill("20");
  await page.getByLabel("Shipping total").fill("15");
  await page.getByLabel("Name", { exact: true }).fill("E2E batch");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("heading", { name: "E2E batch" })).toBeVisible();
  await page.getByPlaceholder("Search your raw cards…").fill("Gradable Dragonite");
  await page.locator("section", { hasText: "Add raw cards" }).getByRole("button", { name: "Add" }).first().click();
  await expect(page.getByText("$35.00")).toBeVisible(); // 20 fee + 15 shipping

  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByText("Sent").first()).toBeVisible();

  // The card is now at the grader, so its page says so.
  await page.goto("/collection?q=Gradable");
  await page.getByRole("link", { name: /Gradable Dragonite/ }).click();
  await expect(page.getByText("When the card comes back")).toBeVisible();

  await page.goto("/submissions");
  await page.getByRole("link", { name: "E2E batch" }).click();
  await page.getByPlaceholder("9.5").fill("10");
  await page.getByRole("button", { name: "Record grades" }).click();
  await expect(page.getByText("Returned").first()).toBeVisible();

  // The graded card now carries the company and grade.
  await page.goto("/collection?q=Gradable");
  await page.getByRole("link", { name: /Gradable Dragonite/ }).click();
  await expect(page.getByText("PSA 10").first()).toBeVisible();
});

test("a card can be put into an open batch from its own page", async ({ page }) => {
  const made = await page.request.post("/api/submissions", { data: { company: "PSA", name: "From the card page" } });
  const { submission } = (await made.json()) as { submission: { id: number } };
  await addCardByHand(page, { name: "Batchable Gyarados", set: "Base Set" });
  await page.getByRole("link", { name: "Open card" }).click();
  await expect(page).toHaveURL(/\/cards\/\d+$/);

  await page.getByRole("button", { name: "Add to a submission" }).click();
  await page.getByLabel("Submission").selectOption({ label: "From the card page · 0 cards" });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/Added to/)).toContainText("From the card page");

  const after = (await (await page.request.get(`/api/submissions/${submission.id}`)).json()) as { submission: { cards: Array<{ name: string }> } };
  expect(after.submission.cards.map((c) => c.name)).toContain("Batchable Gyarados");
});
