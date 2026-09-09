import { expect, test } from "@playwright/test";

test.describe("theme", () => {
  test("follows the system by default and remembers an explicit choice", async ({ browser }) => {
    const dark = await browser.newContext({ colorScheme: "dark" });
    const page = await dark.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // An explicit light choice overrides a dark system preference…
    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // …and survives a reload, applied before the first paint.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");

    // Back to following the system.
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await dark.close();

    const light = await browser.newContext({ colorScheme: "light" });
    const page2 = await light.newPage();
    await page2.goto("/");
    await expect(page2.locator("html")).toHaveAttribute("data-theme", "light");
    await light.close();
  });

  test("the portfolio line and its fill carry the direction", async ({ page }) => {
    // A manual price needs no network, so the chart can be given real history
    // here without reaching a price API.
    const created = await page.request.post("/api/cards", {
      data: { game: "pokemon", name: "Themed Charizard", setName: "Theme Set", manualUngraded: 100 },
    });
    const { card } = (await created.json()) as { card: { id: number } };
    await page.request.post(`/api/cards/${card.id}/price`);
    await page.request.patch(`/api/cards/${card.id}`, { data: { manualUngraded: 250 } });
    await page.request.post(`/api/cards/${card.id}/price`);

    // The card's own chart, rather than the portfolio total, so other tests
    // adding cards to the same collection cannot change the direction here.
    await page.goto(`/cards/${card.id}`);
    const chart = page.locator("svg[aria-label='Value of this card over time']");
    await expect(chart).toBeVisible();
    // The area is painted with a gradient rather than a flat wash.
    await expect(chart.locator("linearGradient")).toHaveCount(1);
    // Rising, so both the line and the fill are the up colour.
    const stroke = await chart.locator("path[stroke]").first().getAttribute("stroke");
    expect(stroke).toBe("var(--chart-good)");
    await expect(page.getByText(/▲/).first()).toBeVisible();

    // Falling reverses both.
    await page.request.patch(`/api/cards/${card.id}`, { data: { manualUngraded: 20 } });
    await page.request.post(`/api/cards/${card.id}/price`);
    await page.goto(`/cards/${card.id}`);
    expect(await chart.locator("path[stroke]").first().getAttribute("stroke")).toBe("var(--chart-bad)");
    await expect(page.getByText(/▼/).first()).toBeVisible();
  });
});

test("a card's own colour still tints its tile", async ({ page }) => {
  // The tile carries both .well and .accent-wash; a background shorthand in
  // either would silently erase the tint, which is how it broke once.
  const created = await page.request.post("/api/cards", {
    data: { game: "pokemon", name: "Tinted Gyarados", setName: "Tint Set", accentColor: "#c2410c" },
  });
  expect(created.ok()).toBe(true);

  await page.goto("/collection?q=Tinted");
  const art = page.locator(".accent-wash").first();
  await expect(art).toBeVisible();
  const image = await art.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(image).toContain("gradient");
});

test.describe("installable app", () => {
  test("serves a manifest, icons and a service worker", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const body = (await manifest.json()) as { name: string; display: string; icons: Array<{ src: string; sizes: string; purpose?: string }> };
    expect(body).toMatchObject({ name: "CollectCollect", display: "standalone" });
    expect(body.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);

    for (const icon of body.icons) {
      const res = await request.get(icon.src);
      expect(res.ok(), icon.src).toBe(true);
      expect(res.headers()["content-type"]).toContain("image/png");
    }

    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    // The collection's own data must never be served from a cache.
    expect(await sw.text()).toContain('url.pathname.startsWith("/api/")');
  });

  test("gives phones a thumb-reachable tab bar and no sideways scroll", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Sections" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Collection" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await tabs.getByRole("link", { name: "Collection" }).click();
    await expect(page).toHaveURL(/\/collection/);
    await expect(tabs.getByRole("link", { name: "Collection" })).toHaveAttribute("aria-current", "page");

    // Settings carries the longest unbreakable strings in the app: the paths
    // to the data directory and the plain-text collection.
    for (const path of ["/settings", "/report", "/submissions"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    }
    await context.close();
  });

  test("has an offline page that needs no session", async ({ request }) => {
    const res = await request.get("/offline");
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain("No connection");
  });
});
