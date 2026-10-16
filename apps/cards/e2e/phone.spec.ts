import { expect, test } from "./fixtures";

/**
 * The phone's own width, not window.innerWidth: Chromium's mobile emulation widens the layout
 * viewport to fit a page that overflows, so innerWidth follows the overflow and a test that
 * compares scrollWidth with it can never fail (theme.spec.ts's check at 390 px is of that kind).
 */
const phone = (width: number) => ({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });

test.describe("at 360 and 412 px", () => {
  for (const width of [360, 412]) {
    test(`the appraisal report stays inside a ${width} px screen, and the tab bar with it`, async ({ browser }) => {
      const context = await browser.newContext(phone(width));
      const page = await context.newPage();
      await page.goto("/report");
      await expect(page.getByRole("heading", { name: "Collection valuation" })).toBeVisible();

      // The page is no wider than the screen (369 px wide at 360 before the table had a box of its own)...
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      // ...which a widened page was not: it also widened the fixed bar and pushed its tabs off the screen.
      const tabs = page.getByRole("navigation", { name: "Sections" });
      await expect(tabs).toHaveCSS("position", "fixed");
      const bar = (await tabs.boundingBox())!;
      expect([bar.x, bar.width]).toEqual([0, width]);
      expect(bar.y + bar.height).toBeGreaterThan(740 - 4);

      // A table wider than the screen scrolls in a box of its own instead.
      const scroller = page.getByRole("table").first().locator("xpath=..");
      expect(await scroller.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
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
      const spill = await page.evaluate((w) => [...document.querySelectorAll("header :is(button, a, summary):not(.cc-palette-panel *)")]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > w + 0.5; })
        .map((el) => el.textContent), width);
      expect(spill).toEqual([]);
      expect(await page.evaluate(() => document.querySelector("header")!.scrollWidth)).toBeLessThanOrEqual(width);
      await context.close();
    });
  }

  test("a printed report lets the table take the page's width, not scroll inside a box", async ({ page }) => {
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
