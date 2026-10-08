import { expect, test } from "./fixtures";

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
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    // Plain http here, and no trusted proxy saying otherwise: no HSTS, which
    // a browser would ignore on this answer and remember from a wrong one.
    expect(headers["strict-transport-security"]).toBeUndefined();
    expect(headers["referrer-policy"]).toBe("no-referrer");
    // Nothing gains from being told which framework this is.
    expect(headers["x-powered-by"]).toBeUndefined();
    // Nothing here uses a camera.
    expect(headers["permissions-policy"]).toContain("camera=()");
    const csp = headers["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("img-src 'self' https://community.cloudflare.steamstatic.com https://steamcommunity-a.akamaihd.net;");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");

    // The proxy runs for /_next/ as well, so a chunk carries every header
    // the page does, the policy included (website.spec.ts holds every one of
    // them to the README).
    const src = await page.locator('script[src^="/_next/static/"]').first().getAttribute("src");
    const asset = await page.request.get(src!);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()["x-content-type-options"]).toBe("nosniff");
    expect(asset.headers()["x-frame-options"]).toBe("DENY");
    expect(asset.headers()["cross-origin-resource-policy"]).toBe("same-origin");
    expect(asset.headers()["content-security-policy"]).toMatch(/^default-src 'none'; /);

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

test("Settings says what this is, which version, under what licence, and what leaves the server", async ({ page }) => {
  await page.goto("/settings");
  const about = page.locator("footer").filter({ has: page.getByRole("heading", { name: "About" }) });
  await expect(about).toContainText(/\d+\.\d+\.\d+/);
  await expect(about.getByRole("link", { name: "MIT licence" })).toHaveAttribute("href", /\/LICENSE$/);
  await expect(about.getByRole("link", { name: "source" })).toHaveAttribute("href", /^https:\/\/github\.com\//);
  await expect(about).toContainText("Nothing else leaves this server.");
});
