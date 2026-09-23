import { expect, test } from "@playwright/test";

test("choosing a shorter range under the chart's crosshair leaves the page working", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Two snapshots of one card, priced from its manual entry alone: nothing
  // prices an "other" card over the network unless PriceCharting is set up.
  const headers = { "sec-fetch-site": "same-origin" };
  const created = await request.post("/api/cards", { headers, data: { game: "other", name: "Crosshair Pennant", manualUngraded: 25 } });
  expect(created.status()).toBe(201);
  const { card }: { card: { id: number } } = await created.json();
  for (let i = 0; i < 2; i++) {
    const priced: { stored: boolean } = await (await request.post(`/api/cards/${card.id}/price`, { headers })).json();
    expect(priced.stored).toBe(true);
  }

  await page.goto("/");
  const chart = page.getByRole("img", { name: "Collection value over time" });
  await expect(chart).toBeVisible();
  // Put the crosshair on the last point from the keyboard: moving focus on
  // does not clear it, the way the pointer leaving the chart does.
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText(/^raw NM .* priced$/)).toBeVisible();

  // Ten days on, the last week holds none of these snapshots, so "1W" draws
  // only the latest one and the crosshair's index is past the end of it.
  await page.clock.setFixedTime(Date.now() + 10 * 864e5);
  await page.getByRole("button", { name: "1W", exact: true }).focus();
  await page.keyboard.press("Enter");

  await expect(chart).toBeVisible();
  await expect(page.getByText(/^raw NM .* priced$/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
