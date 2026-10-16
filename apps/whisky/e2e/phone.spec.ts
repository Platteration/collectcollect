import type { FileChooser } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The phone's own width, not window.innerWidth: Chromium's mobile emulation widens the layout
 * viewport to fit a page that overflows, so innerWidth follows the overflow and a test that
 * compares scrollWidth with it can never fail.
 */
const phone = (width: number) => ({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });

test.describe("a bottle collection on a phone", () => {
  for (const width of [360, 412]) {
    test(`the report stays inside a ${width} px screen, and the tab bar with it`, async ({ browser }) => {
      const context = await browser.newContext(phone(width));
      const page = await context.newPage();
      for (const path of ["/report", "/report?photos=1"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: "Whisky collection valuation" })).toBeVisible();

        // The page is no wider than the screen...
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(width);
        // ...which a widened page was not: it also widened the fixed bar and pushed its tabs off the screen.
        const tabs = page.getByRole("navigation", { name: "Sections" });
        await expect(tabs).toHaveCSS("position", "fixed");
        const bar = (await tabs.boundingBox())!;
        expect([bar.x, bar.width]).toEqual([0, width]);
        expect(bar.y + bar.height).toBeGreaterThan(740 - 4);

        // Many columns, wider than the screen: the table scrolls in a box of its own instead.
        const scroller = page.getByRole("table").first().locator("xpath=..");
        expect(await scroller.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
        expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth), "the table needs its box").toBe(true);

        // The last column is still there, one scroll away.
        await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
        await expect(page.getByRole("columnheader", { name: "Basis" })).toBeInViewport();
      }
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

  test("Take photo opens the camera for one picture; Choose photos opens the gallery for several", async ({ browser }) => {
    const context = await browser.newContext(phone(360));
    const page = await context.newPage();
    await page.goto("/add");
    const attributes = (chooser: FileChooser) =>
      chooser.element().evaluate((el) => ({ capture: (el as Element).getAttribute("capture"), accept: (el as Element).getAttribute("accept") }));

    const [camera] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Take photo" }).click()]);
    expect(camera.isMultiple()).toBe(false);
    expect(await attributes(camera)).toEqual({ capture: "environment", accept: "image/*" });

    const [files] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose photos" }).click()]);
    expect(files.isMultiple()).toBe(true);
    expect(await attributes(files)).toEqual({ capture: null, accept: "image/*" });
    await context.close();
  });

  test("Settings lists what the tab bar leaves out, and the header's own row stays hidden", async ({ browser }) => {
    const context = await browser.newContext(phone(360));
    const page = await context.newPage();
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Sections" });
    // Five tabs fit and Import is not one of them, and the header's own row, which has it, is not shown on a phone.
    await expect(tabs.getByRole("link")).toHaveCount(5);
    await expect(tabs.getByRole("link", { name: "Import" })).toHaveCount(0);
    await expect(page.locator("header").getByRole("link", { name: "Import" })).toBeHidden();
    // The last tab says More, since Settings lists what the bar leaves out.
    await tabs.getByRole("link", { name: "More" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    const more = page.getByRole("navigation", { name: "More sections" });
    await expect(more).toBeVisible();
    await expect(more.getByRole("heading", { name: "Go to" })).toBeVisible();
    await more.getByRole("link", { name: "Import" }).click();
    await expect(page).toHaveURL(/\/import$/);
    await context.close();
  });

  test("the list of what the tab bar leaves out is for phones only", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    // In the page, for the phones, and not drawn on a screen that has the header's own row.
    await expect(page.locator("nav[aria-label='More sections']")).toHaveCount(1);
    await expect(page.locator("nav[aria-label='More sections']")).toBeHidden();
  });
});
