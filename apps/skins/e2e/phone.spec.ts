import { expect, test } from "@playwright/test";

test.describe("installable app", () => {
  test("serves a manifest, icons and a service worker of its own", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const body = (await manifest.json()) as { name: string; display: string; icons: Array<{ src: string; sizes: string; purpose?: string }> };
    expect(body).toMatchObject({ name: "CollectCollect Skins", display: "standalone" });
    expect(body.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
    for (const icon of body.icons) {
      const res = await request.get(icon.src);
      expect(res.ok(), icon.src).toBe(true);
      expect(res.headers()["content-type"]).toContain("image/png");
    }

    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    const text = await sw.text();
    // The inventory's own data must never be served from a cache, and this
    // worker's caches must be its own, not the card app's.
    expect(text).toContain('url.pathname.startsWith("/api/")');
    expect(text).toContain("collectcollect-skins-shell");
  });

  test("has an offline page", async ({ request }) => {
    const res = await request.get("/offline");
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain("No connection");
  });
});

test.describe("on a phone", () => {
  test("puts the tab bar within thumb reach and never scrolls sideways", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/");

    const tabs = page.getByRole("navigation", { name: "Sections" });
    await expect(tabs).toBeVisible();

    // The tab bar is a shared component, so its classes come from outside this
    // app's own tree — which is exactly what Tailwind tree-shakes if the app's
    // stylesheet does not point at it. Where the bar ends up cannot tell you
    // that happened, because the page's own flex column puts a static bar at
    // the bottom too; whether it is *fixed* there can, so that is what is
    // asserted. Lose it and the bar scrolls away with the page.
    await expect(tabs).toHaveCSS("position", "fixed");
    const box = (await tabs.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(844 - 4);
    expect(box.width).toBeCloseTo(390, 0);

    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await tabs.getByRole("link", { name: "Inventory" }).click();
    await expect(page).toHaveURL(/\/inventory/);
    await expect(tabs.getByRole("link", { name: "Inventory" })).toHaveAttribute("aria-current", "page");

    // The item page carries the longest unbreakable strings in the app: market
    // hash names, and floats printed to ten decimals.
    for (const path of ["/inventory", "/items/1", "/items/2"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    }
    await context.close();
  });

  test("reaches every page from the last tab", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Sections" });
    // Five tabs fit; the last one is the way to the rest, and says so.
    await expect(tabs.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await tabs.getByRole("link", { name: "More" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    const more = page.getByRole("navigation", { name: "More sections" });
    await expect(more).toBeVisible();
    for (const label of ["Add an item", "Import an inventory", "Valuation report"]) {
      await expect(more.getByRole("link", { name: label })).toBeVisible();
    }
    await more.getByRole("link", { name: "Valuation report" }).click();
    await expect(page).toHaveURL(/\/report$/);
    await context.close();
  });

  test("keeps the theme choice, and applies it before the page is drawn", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Reload: the inline script has to resolve the stored choice before the
    // first paint, or the page flashes the wrong theme.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });
});
