import { expect, test } from "./fixtures";

/** A figure as the page writes it ("$1,234.50"), as a number. */
const dollars = (text: string) => Number(text.replace(/[$,]/g, ""));

/**
 * The dashboard's value chart as a brokerage draws it: what the collection
 * cost beside what it is worth, what came in apart from what the market did,
 * and a scale fitted to the data. Prices are manual, so nothing here needs a
 * price API.
 */
test.describe("the value timeline", () => {
  test("draws what the copies cost beside the value, and the legend hides it", async ({ page }) => {
    const created = await page.request.post("/api/cards", {
      data: { game: "pokemon", name: "Timeline Charizard", setName: "Timeline Set", quantity: 2, purchasePrice: 30, manualUngraded: 50 },
    });
    const { card } = (await created.json()) as { card: { id: number } };
    await page.request.post(`/api/cards/${card.id}/price`);
    await page.request.patch(`/api/cards/${card.id}`, { data: { manualUngraded: 60 } });
    await page.request.post(`/api/cards/${card.id}/price`);

    await page.goto("/");
    const chart = page.locator("svg[aria-label^='Collection value over time']");
    await expect(chart).toBeVisible();
    // The cost is one dashed line, in the legend and in the chart.
    const toggle = page.getByRole("button", { name: /^Cost basis \$/ });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(chart.locator("[data-series=basis]").first()).toBeAttached();
    // The axis is fitted to the data, with a dotted rule where the window opened.
    await expect(chart.locator("[data-series=opening]")).toHaveCount(1);
    await expect(page.getByText(/^Range start \$/)).toBeVisible();

    // Hidden from the legend, it is gone from the chart and the legend says so.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(chart.locator("[data-series=basis]")).toHaveCount(0);
    await toggle.click();
    await expect(chart.locator("[data-series=basis]").first()).toBeAttached();

    // What the crosshair lands on is said out loud, with the cost and the gain over it.
    const live = page.locator("[role=status][aria-live=polite]").first();
    await chart.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(live).toHaveText(/cost basis \$[\d,.]+, (ahead|behind) by \$/);
    // And drawn: the gain over the cost carries its direction in an arrow and a sign, not only a colour.
    await expect(page.locator(".tooltip-surface")).toContainText(/cost basis \$[\d,.]+ · (▲ \+|▼ −)\$[\d,.]+/);
  });

  test("splits the window's change into cards added and prices moving, and the two add up to it", async ({ page }) => {
    const created = await page.request.post("/api/cards", {
      data: { game: "pokemon", name: "Timeline Blastoise", setName: "Timeline Set", purchasePrice: 20, manualUngraded: 80 },
    });
    const { card } = (await created.json()) as { card: { id: number } };
    await page.request.post(`/api/cards/${card.id}/price`);
    await page.request.patch(`/api/cards/${card.id}`, { data: { manualUngraded: 95 } });
    await page.request.post(`/api/cards/${card.id}/price`);

    await page.goto("/");
    const section = page.locator("section.card-surface", { has: page.locator("svg[aria-label^='Collection value over time']") }).first();
    await expect(section.getByText(/from prices moving/)).toBeVisible();
    const text = (await section.innerText()).replace(/\s+/g, " ");
    // The headline change, the part of it that came in or left, and the part that was the market,
    // each with the arrow and the sign its direction needs.
    const headline = /([▲▼]) \$([\d,.]+) (?:since|on) /.exec(text);
    const added = /\$([\d,.]+) of that is cards added or newly priced/.exec(text);
    const left = /\$([\d,.]+) left with cards sold/.exec(text);
    const move = /([▲▼]) \$([\d,.]+)(?: \([\d.]+%\))? from prices moving/.exec(text);
    expect(headline && move && (added || left)).toBeTruthy();
    const signed = (arrow: string | undefined, amount: string | undefined) => (arrow === "▼" ? -1 : 1) * dollars(amount ?? "0");
    const flows = added ? dollars(added[1] ?? "0") : -dollars(left?.[1] ?? "0");
    expect(signed(headline?.[1], headline?.[2])).toBeCloseTo(flows + signed(move?.[1], move?.[2]), 2);
  });

  test("a phone sees the chart and its legend without scrolling sideways", async ({ browser }) => {
    for (const width of [360, 412]) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await page.goto("/");
      const chart = page.locator("svg[aria-label^='Collection value over time']");
      await expect(chart).toBeVisible();
      const key = page.getByRole("list", { name: "Chart key" });
      await expect(key).toBeVisible();
      // Every item of the key is inside the screen, and the toggle is a target a thumb can hit.
      const box = await key.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      const toggle = page.getByRole("button", { name: /^Cost basis \$/ });
      await expect(toggle).toBeVisible();
      expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await context.close();
    }
  });

  test("a card's own chart has the price paid drawn across it", async ({ page }) => {
    const created = await page.request.post("/api/cards", {
      data: { game: "pokemon", name: "Timeline Venusaur", setName: "Timeline Set", purchasePrice: 25, manualUngraded: 40 },
    });
    const { card } = (await created.json()) as { card: { id: number } };
    await page.request.post(`/api/cards/${card.id}/price`);
    await page.request.patch(`/api/cards/${card.id}`, { data: { manualUngraded: 55 } });
    await page.request.post(`/api/cards/${card.id}/price`);

    await page.goto(`/cards/${card.id}`);
    const chart = page.locator("svg[aria-label^='Value of this card over time']");
    await expect(chart).toBeVisible();
    // One level across the whole chart: as wide as the chart and as tall as a hairline, so
    // "visible" to the browser is not the test (a level line has no height).
    const paid = chart.locator("[data-series=basis]");
    await expect(paid).toHaveCount(1);
    const width = await paid.evaluate((el) => (el as unknown as SVGGraphicsElement).getBBox().width);
    const chartWidth = await chart.evaluate((el) => (el as unknown as SVGSVGElement).viewBox.baseVal.width);
    expect(width).toBeGreaterThan(chartWidth / 2);
    const live = page.locator("[role=status][aria-live=polite]").first();
    await chart.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(live).toHaveText(/paid \$25\.00, ahead by \$30\.00/);
  });
});
