import { expect, test } from "@playwright/test";

test("choosing a shorter range under the chart's crosshair leaves the page working", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Three snapshots of one card, priced from its manual entry alone: nothing
  // prices an "other" card over the network unless PriceCharting is set up.
  const headers = { "sec-fetch-site": "same-origin" };
  const created = await request.post("/api/cards", { headers, data: { game: "other", name: "Crosshair Pennant", manualUngraded: 25 } });
  expect(created.status()).toBe(201);
  const { card }: { card: { id: number } } = await created.json();
  for (let i = 0; i < 3; i++) {
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
  // only the latest one and leaves the crosshair's index past the end of it.
  await page.clock.setFixedTime(Date.now() + 10 * 864e5);
  await page.getByRole("button", { name: "1W", exact: true }).focus();
  await page.keyboard.press("Enter");

  await expect(chart).toBeVisible();
  await expect(page.getByText(/^raw NM .* priced$/)).toHaveCount(0);

  // That index is dropped, not kept, so the arrow keys start from an end of the
  // shorter series and one press puts the crosshair back. Kept, the index was
  // the last of at least three points, one step left of it is at least 1, and
  // 1W draws only 0.
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText(/^raw NM .* priced$/)).toBeVisible();

  // Nor does a longer range chosen later bring it back. With the crosshair on
  // the last of the longer range and 1W chosen under it, choosing 1M again
  // shows the range ("since …" in the header, no tooltip), not the old point.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "1M", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^since /)).toBeVisible();
  await chart.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText(/^raw NM .* priced$/)).toBeVisible();
  await page.getByRole("button", { name: "1W", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("no earlier snapshot to compare")).toBeVisible();
  await expect(page.getByText(/^raw NM .* priced$/)).toHaveCount(0);
  await page.getByRole("button", { name: "1M", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^since /)).toBeVisible();
  await expect(page.getByText(/^raw NM .* priced$/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
