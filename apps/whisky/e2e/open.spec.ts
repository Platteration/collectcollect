import { expect, test } from "@playwright/test";

/**
 * Opening a bottle is the one thing here that is whisky's and not the
 * engine's, and it is the one that changes money: a copy leaves a stack, its
 * value stops moving, and it stops counting.
 */
test.describe("opening a bottle", () => {
  test("takes one copy off a stack and freezes what it was worth", async ({ page, request }) => {
    const created = await request.post("/api/items", {
      data: { distillery: "Caol Ila", expression: "12 Year Old", ageStatement: 12, region: "islay", quantity: 3, purchasePrice: 55, manualValue: 70 },
    });
    expect(created.status()).toBe(201);
    const { item } = (await created.json()) as { item: { id: number } };

    await page.goto(`/items/${item.id}`);
    await expect(page.getByText("×3")).toBeVisible();
    await page.getByRole("button", { name: "Open a bottle" }).click();
    await page.getByRole("button", { name: "Yes, open it" }).click();

    // The opened bottle is a row of its own, at the value the stack had.
    await expect(page.getByRole("heading", { name: "Caol Ila 12 Year Old" })).toBeVisible();
    await expect(page.getByText(/Open since \d{4}-\d{2}-\d{2} · 100% left/)).toBeVisible();
    await expect(page.getByText(/Frozen at \$70\.00 when it was opened/)).toBeVisible();
    await expect(page.getByText(/not counted in the portfolio total/)).toBeVisible();
    // It took the cost of the oldest copy with it.
    await expect(page.getByText(/paid \$55\.00/)).toBeVisible();
    expect(page.url()).not.toContain(`/items/${item.id}`);

    // And the stack it came from is one shorter, still sealed, still counting.
    await page.goto(`/items/${item.id}`);
    await expect(page.getByText("×2")).toBeVisible();
    await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
    await expect(page.getByText(/not counted in the portfolio total/)).toHaveCount(0);
  });

  test("can be called off before anything happens", async ({ page, request }) => {
    const created = await request.post("/api/items", {
      data: { distillery: "Talisker", expression: "10 Year Old", region: "islands", quantity: 2, purchasePrice: 45 },
    });
    const { item } = (await created.json()) as { item: { id: number } };

    await page.goto(`/items/${item.id}`);
    await page.getByRole("button", { name: "Open a bottle" }).click();
    await page.getByRole("button", { name: "Keep it sealed" }).click();
    await expect(page.getByRole("button", { name: "Open a bottle" })).toBeVisible();
    await expect(page.getByText("×2")).toBeVisible();
  });

  test("opens the only copy in place rather than splitting it", async ({ page, request }) => {
    const created = await request.post("/api/items", {
      data: { distillery: "Oban", expression: "14 Year Old", region: "highland", purchasePrice: 60, manualValue: 75 },
    });
    const { item } = (await created.json()) as { item: { id: number } };

    await page.goto(`/items/${item.id}`);
    await page.getByRole("button", { name: "Open a bottle" }).click();
    await page.getByRole("button", { name: "Yes, open it" }).click();

    await expect(page).toHaveURL(new RegExp(`/items/${item.id}$`));
    await expect(page.getByText(/Open since \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await expect(page.getByText(/Frozen at \$75\.00 when it was opened/)).toBeVisible();
  });
});
