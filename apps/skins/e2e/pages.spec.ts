import { expect, test } from "@playwright/test";

test.describe("a page that is not there", () => {
  test("is a 404 with the app still around it", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Inventory" })).toBeVisible();
    await page.getByRole("link", { name: "Open the inventory" }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    expect((await page.goto("/items/999999"))?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();
  });
});

test.describe("what every response carries", () => {
  test("security headers, and a content security policy the page's own scripts satisfy", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    const response = await page.goto("/");
    const headers = response!.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    // Nothing here uses a camera.
    expect(headers["permissions-policy"]).toContain("camera=()");
    const csp = headers["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("img-src 'self' data: blob: https://community.cloudflare.steamstatic.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");

    // The inline theme script carries the nonce and ran, and the app's own
    // bundles loaded, so the page is interactive.
    await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "System" }).click();

    for (const path of ["/inventory", "/spread", "/settings", "/report", "/import", "/add"]) await page.goto(path);
    expect(violations).toEqual([]);
    const again = await page.goto("/");
    expect(again!.headers()["content-security-policy"]).not.toBe(csp);
  });
});
