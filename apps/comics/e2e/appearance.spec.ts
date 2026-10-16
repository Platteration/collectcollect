import { devices, expect, test } from "@playwright/test";

/**
 * Every theme and palette is a tap away on a phone, from the header and from
 * Settings, and a stored choice is painted before the app's own scripts run.
 * The shared engine draws this frame for every hobby built on it.
 */
const PALETTES = ["Teal", "Amber", "Sky", "Indigo", "Violet", "Plum", "Copper", "Slate"];

// A phone, as far as a describe block may say so: the browser stays the project's.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
const phone = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch };

test.describe("appearance on a phone", () => {
  test.use(phone);

  test("every theme and palette can be chosen from the header", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const menu = page.locator(".cc-palette-menu");
    for (const [mode, theme] of [["Dark", "dark"], ["Light", "light"]] as const) {
      await page.getByRole("button", { name: mode, exact: true }).tap();
      await expect(html).toHaveAttribute("data-theme", theme);
      for (const name of PALETTES) {
        if (!(await menu.evaluate((details: HTMLDetailsElement) => details.open))) await page.getByLabel("Appearance palettes").tap();
        await menu.getByRole("button", { name, exact: true }).tap();
        await expect(html).toHaveAttribute("data-scheme", name.toLowerCase());
        await expect(html).toHaveAttribute("data-theme", theme);
      }
    }
    // System follows the device, both ways.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole("button", { name: "System", exact: true }).tap();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).toHaveAttribute("data-theme", "light");
  });

  test("a stored theme and palette are painted before the app starts, without a policy violation", async ({ page }) => {
    const refused: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) refused.push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      localStorage.setItem("colorScheme", "plum");
    });
    // With the app's own scripts kept away, only the inline script in <head> can apply them.
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "plum");
    expect(refused).toEqual([]);
  });

  test("Settings offers every palette, and a choice there applies at once", async ({ page }) => {
    await page.goto("/settings");
    const picker = page.locator("main").getByRole("group", { name: "Color scheme" });
    await expect(picker.getByRole("button")).toHaveCount(PALETTES.length);
    await picker.getByRole("button", { name: "Copper", exact: true }).tap();
    await expect(page.locator("html")).toHaveAttribute("data-scheme", "copper");
    await expect(picker.getByRole("button", { name: "Copper", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});
