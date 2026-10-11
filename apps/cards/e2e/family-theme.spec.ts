import { expect, test } from "@playwright/test";

test("header palette follows the user onto every page without recoloring returns", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  const before = await page.locator("html").evaluate((el) => {
    const style = getComputedStyle(el);
    return ["--background", "--chart-good-text", "--chart-bad-text", "--chart-series-1"].map((key) => style.getPropertyValue(key).trim());
  });
  await page.getByLabel("Appearance palettes").click();
  await page.locator(".cc-palette-panel").getByRole("button", { name: "Indigo", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "indigo");
  const after = await page.locator("html").evaluate((el) => {
    const style = getComputedStyle(el);
    return ["--background", "--chart-good-text", "--chart-bad-text", "--chart-series-1"].map((key) => style.getPropertyValue(key).trim());
  });
  expect(after[0]).not.toBe(before[0]);
  expect(after.slice(1)).toEqual(before.slice(1));
  await page.keyboard.press("Escape");
  await expect(page.locator(".cc-palette-menu")).not.toHaveAttribute("open");
  await page.goto("/collection");
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "indigo");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "indigo");
  const ground = await page.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--background").trim());
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", ground);
});

test("a different tab can change the palette while Settings is closed", async ({ page, context }) => {
  await page.goto("/collection");
  const other = await context.newPage();
  await other.goto("/");
  await other.getByLabel("Appearance palettes").click();
  await other.locator(".cc-palette-panel").getByRole("button", { name: "Plum", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "plum");
  await other.close();
});

test("blocked persistence keeps the selection usable and reports it", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cc-appearance-warning")).toContainText("cannot be saved");
  await page.getByLabel("Appearance palettes").click();
  await page.locator(".cc-palette-panel").getByRole("button", { name: "Copper", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scheme", "copper");
  await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.evaluate(() => dispatchEvent(new Event("afterprint")));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});


test("the palette panel stays inside a phone viewport", async ({ page }) => {
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/");
    await page.getByLabel("Appearance palettes").click();
    await expect(page.locator(".cc-palette-panel")).toBeVisible();
    await expect.poll(async () => page.locator(".cc-palette-panel").evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
    })).toBe(true);
  }
});
