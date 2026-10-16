import { expect, test } from "./fixtures";

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

/**
 * The phone's own width, not window.innerWidth: Chromium's mobile emulation widens the layout
 * viewport to fit a page that overflows, so innerWidth follows the overflow and a test that
 * compares scrollWidth with it can never fail.
 */
const phone = (width: number) => ({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });

test.describe("at 360 and 412 px", () => {
  for (const width of [360, 412]) {
    test(`the valuation report stays inside a ${width} px screen, and the tab bar with it`, async ({ browser }) => {
      const context = await browser.newContext(phone(width));
      const page = await context.newPage();
      await page.goto("/report");
      await expect(page.getByRole("heading", { name: "Inventory valuation" })).toBeVisible();

      // The page is no wider than the screen...
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      // ...which a widened page was not: it also widened the fixed bar and pushed its tabs off the screen.
      const tabs = page.getByRole("navigation", { name: "Sections" });
      await expect(tabs).toHaveCSS("position", "fixed");
      const bar = (await tabs.boundingBox())!;
      expect([bar.x, bar.width]).toEqual([0, width]);
      expect(bar.y + bar.height).toBeGreaterThan(740 - 4);

      // The holdings table is wider than the screen. It scrolls in a box of its own instead.
      const scroller = page.getByRole("table").first().locator("xpath=..");
      expect(await scroller.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
      expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth), "the table needs its box").toBe(true);

      // The last column is still there, one scroll away.
      await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await expect(page.getByRole("columnheader", { name: "Basis" })).toBeInViewport();
      await context.close();
    });

    test(`the header's theme buttons are 44 px targets on touch at ${width} px, and the header still fits`, async ({ browser }) => {
      const context = await browser.newContext(phone(width));
      const page = await context.newPage();
      await page.goto("/");
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      const theme = page.getByRole("group", { name: "Theme" });
      for (const name of ["Light", "Dark", "System"]) {
        const box = (await theme.getByRole("button", { name }).boundingBox())!;
        expect([name, box.width >= 44, box.height >= 44]).toEqual([name, true, true]);
      }
      const palette = (await page.locator("summary[aria-label='Appearance palettes']").boundingBox())!;
      expect(palette.width).toBeGreaterThanOrEqual(44);
      expect(palette.height).toBeGreaterThanOrEqual(44);
      // Nothing in the header is cut off at either edge, and the header does not scroll.
      const spill = await page.evaluate((w) => [...document.querySelectorAll("header :is(button, a, summary):not(.cc-palette-panel *)")]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > w + 0.5; })
        .map((el) => el.textContent), width);
      expect(spill).toEqual([]);
      expect(await page.evaluate(() => document.querySelector("header")!.scrollWidth)).toBeLessThanOrEqual(width);
      await context.close();
    });
  }

  test("a printed report lets the holdings table take the page's width, not scroll inside a box", async ({ page }) => {
    await page.goto("/report");
    const scroller = page.getByRole("table").first().locator("xpath=..");
    expect(await scroller.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    await page.emulateMedia({ media: "print" });
    expect(await scroller.evaluate((el) => getComputedStyle(el).overflowX)).toBe("visible");
  });

  test("with a mouse the theme buttons keep their size", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
    const box = (await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).boundingBox())!;
    expect([box.width, box.height]).toEqual([36, 36]);
  });
});
