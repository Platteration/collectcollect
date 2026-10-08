import { expect, test } from "@playwright/test";

test("missing costs lead to editable purchase lots on a phone", async ({ page, request }) => {
  const response = await request.post("/api/cards", { data: { game: "pokemon", name: "Lot repair Dragonite", quantity: 2, purchasePrice: 10 } });
  expect(response.ok()).toBe(true);
  const { card } = await response.json() as { card: { id: number } };
  const bought = await request.post(`/api/cards/${card.id}/acquisitions`, { data: { quantity: 1, unitCost: null } });
  expect(bought.ok()).toBe(true);
  const { acquisitions } = await bought.json() as { acquisitions: Array<{ id: number; unitCost: number | null }> };
  const missing = acquisitions.find((lot) => lot.unitCost === null)!;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/collection?cost=missing&q=Lot+repair");
  await page.getByRole("link", { name: "Record costs for Lot repair Dragonite" }).click();
  await page.getByRole("button", { name: `Edit purchase ${missing.id}`, exact: true }).click();
  const form = page.getByRole("form", { name: "Correct purchase" });
  await form.getByLabel("Cost per copy (USD)", { exact: true }).fill("5");
  await page.screenshot({ path: "test-results/lot-correction-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await form.getByRole("button", { name: "Save purchase" }).click();
  await expect(form).toHaveCount(0);
  const stored = await (await request.get(`/api/cards/${card.id}`)).json() as { card: { quantity: number; purchasePrice: number } };
  expect(stored.card).toMatchObject({ quantity: 3, purchasePrice: 8.33 });
  await page.goto("/collection?cost=missing&q=Lot+repair");
  await expect(page.getByText("Nothing matches", { exact: true })).toBeVisible();
});

test("sold purchases expose notes while locking cost and date", async ({ page, request }) => {
  const added = await request.post("/api/cards", { data: { game: "pokemon", name: "Sold lot Gengar", quantity: 2, purchasePrice: 10 } });
  const { card } = await added.json() as { card: { id: number } };
  const sold = await request.post(`/api/cards/${card.id}/sales`, { data: { quantity: 1, unitPrice: 20 } });
  expect(sold.ok()).toBe(true);
  const { sale } = await sold.json() as { sale: { id: number } };
  await page.goto(`/cards/${card.id}`);
  await page.getByRole("button", { name: /^Edit purchase/ }).click();
  const form = page.getByRole("form", { name: "Correct purchase" });
  await expect(form.getByLabel("Cost per copy (USD)", { exact: true })).toBeDisabled();
  await expect(form.getByLabel("Acquired", { exact: true })).toBeDisabled();
  await form.getByLabel("Source", { exact: true }).fill("Receipt found");
  await form.getByRole("button", { name: "Save purchase" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText(/Receipt found/)).toBeVisible();
  // This suite shares its write collection with the money specs. Restore this
  // scenario's sale so their portfolio totals do not depend on file order.
  expect((await request.delete(`/api/sales/${sale.id}`)).ok()).toBe(true);
});
