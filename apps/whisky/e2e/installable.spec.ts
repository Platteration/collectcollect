import type { Browser } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";

/**
 * What makes the app installable on a phone, and what it does when its page
 * fails to start. The shell (manifest, icons, favicon, worker, offline notice,
 * safety net) is the shared engine's, drawn the same for every hobby built on
 * it, so whisky stands for them; what is whisky's own is its name and colours,
 * which are what the first test reads back.
 *
 * What only a real phone can say is whether Chrome offers "Install app", what
 * the splash screen looks like and how the icon sits under a launcher's mask:
 * the browser is asked here whether the manifest is one it accepts and finds
 * nothing in the way of installing it (`Page.getInstallabilityErrors`).
 */
const GROUND = "#120c06"; // spec.theme.dark in src/lib/spec.ts, which is the manifest's colour and the maskable icon's ground

const started = () => (window as unknown as { __collectcollectStarted?: boolean }).__collectcollectStarted === true;

test.describe("an installable app", () => {
  test("serves a manifest, icons, a favicon, a worker, the safety net and an offline page", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = (await res.json()) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      scope: string;
      background_color: string;
      theme_color: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
      shortcuts: Array<{ url: string }>;
    };
    expect(manifest).toMatchObject({ name: "CollectCollect Whisky", short_name: "Whisky", display: "standalone", start_url: "/", scope: "/", background_color: GROUND, theme_color: GROUND });
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of manifest.icons) {
      const png = await request.get(icon.src);
      expect(png.status(), icon.src).toBe(200);
      expect(png.headers()["content-type"], icon.src).toBe("image/png");
    }
    // Each shortcut opens a page that is there.
    for (const shortcut of manifest.shortcuts) expect((await request.get(shortcut.url)).status(), shortcut.url).toBe(200);

    for (const path of ["/icons/apple-touch-icon.png", "/favicon.ico"]) {
      const icon = await request.get(path);
      expect(icon.status(), path).toBe(200);
      expect(icon.headers()["content-type"], path).toMatch(/^image\/(png|x-icon)$/);
      expect((await icon.body()).length, path).toBeGreaterThan(100);
    }

    const worker = await request.get("/sw.js");
    expect(worker.status()).toBe(200);
    expect(worker.headers()["content-type"]).toContain("text/javascript");
    // Revalidated on every load, so a new build's worker replaces the old one, and allowed to control the whole origin.
    expect(worker.headers()["cache-control"]).toBe("no-cache");
    expect(worker.headers()["service-worker-allowed"]).toBe("/");
    const source = await worker.text();
    // The bottles' own data is never served from a cache, and this worker's caches are its own.
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain("collectcollect-whisky-shell-");

    const guard = await request.get("/guard.js");
    expect(guard.status()).toBe(200);
    expect(guard.headers()["content-type"]).toContain("text/javascript");
    expect(await guard.text()).toContain("CollectCollect Whisky didn't finish loading");

    const offline = await request.get("/offline");
    expect(offline.status()).toBe(200);
    const text = await offline.text();
    expect(text).toContain("No connection");
    // The server's markup separates the noun from its sentence with comment markers.
    expect(text).toMatch(/keeps your (?:<!-- -->)?bottles(?:<!-- -->)? on its own server/);
  });

  test("every answer, the favicon and a missing file included, leaves with the site's security headers", async ({ request }) => {
    // The proxy once skipped the favicon and the framework's build output, which left them, and the 404 drawn for a path with nothing at it, without a header.
    for (const [path, status] of [["/favicon.ico", 200], ["/icons/icon-192.png", 200], ["/_next/static/missing.js", 404], ["/no-such-file", 404]] as const) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(status);
      expect(res.headers()["content-security-policy"], path).toContain("default-src 'none'");
      expect(res.headers()["x-content-type-options"], path).toBe("nosniff");
      expect(res.headers()["x-frame-options"], path).toBe("DENY");
    }
  });

  test("links its manifest and icons from the page, and the browser finds nothing in the way of installing it", async ({ page, baseURL }) => {
    await page.goto("/");
    await page.waitForFunction(started);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
    expect(await page.locator('link[rel="icon"]').evaluateAll((links) => links.map((l) => l.getAttribute("href")))).toEqual(["/favicon.ico", "/icons/icon-192.png"]);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);

    // The browser reads the manifest only when asked, which manifest-src governs: ask the way an install would.
    const cdp = await page.context().newCDPSession(page);
    try {
      const manifest = await cdp.send("Page.getAppManifest", {});
      expect(manifest.errors).toEqual([]);
      expect(manifest.url).toBe(`${new URL(baseURL!).origin}/manifest.webmanifest`);
      expect((JSON.parse(manifest.data ?? "{}") as { name?: string }).name).toBe("CollectCollect Whisky");
      // Chrome's own list of what would stop "Install app" from being offered: a missing icon, an address that is not secure (127.0.0.1 is), a manifest it cannot use.
      expect(await cdp.send("Page.getInstallabilityErrors", {})).toEqual({ installabilityErrors: [] });
    } finally {
      await cdp.detach();
    }
  });

  test("its service worker installs on localhost, takes the page over and keeps the offline notice", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(started);
    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return { scope: ready.scope, script: ready.active?.scriptURL };
    });
    expect(registration.script).toBe(new URL("/sw.js", page.url()).href);
    expect(registration.scope).toBe(new URL("/", page.url()).href);

    // It activates, then claims the page it was registered from.
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state), { timeout: 15_000 }).toBe("activated");

    // Installing fetched the shell, and failed if any of it had answered with anything but a success.
    const held = await page.evaluate(async () => {
      const out: Record<string, string[]> = {};
      for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname).sort();
      return out;
    });
    const names = Object.keys(held);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^collectcollect-whisky-shell-[A-Za-z0-9_-]+$/);
    expect(held[names[0]!]).toEqual(["/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest", "/offline"]);
    const offline = await page.evaluate(async () => (await caches.match("/offline"))?.text());
    expect(offline).toContain("No connection");

    // It leaves the bottles' own data to the network.
    const items = await page.evaluate(async () => {
      const res = await fetch("/api/items");
      return { status: res.status, cached: (await caches.match("/api/items")) !== undefined };
    });
    expect(items).toEqual({ status: 200, cached: false });
  });
});

test.describe("the safety net", () => {
  /** A page of its own: no worker, so a script the test refuses is refused for good. */
  async function freshPage(browser: Browser, baseURL: string | undefined): Promise<Page> {
    const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
    return context.newPage();
  }

  test("a page whose scripts fail to arrive says so, with a way to try again", async ({ browser, baseURL }) => {
    const page = await freshPage(browser, baseURL);
    try {
      await page.route((url) => url.pathname.startsWith("/_next/static/chunks/") && url.pathname.endsWith(".js"), (route) => route.abort());
      await page.goto("/");
      const note = page.getByRole("alert").filter({ hasText: "CollectCollect Whisky didn't finish loading" });
      await expect(note).toBeVisible({ timeout: 15_000 });
      await expect(note.getByRole("button", { name: "Reload" })).toBeVisible();
    } finally {
      await page.context().close();
    }
  });

  test("a page that starts never does, even once its grace period is over", async ({ browser, baseURL }) => {
    const page = await freshPage(browser, baseURL);
    try {
      await page.goto("/");
      await page.waitForFunction(started);
      // After load the guard waits four seconds for a page to start.
      await page.waitForTimeout(5_000);
      await expect(page.locator(".boot-note")).toHaveCount(0);
    } finally {
      await page.context().close();
    }
  });

  test("without JavaScript the page says what still works, and still reads", async ({ playwright, baseURL }) => {
    // Scripting off in Blink itself, so <noscript> renders as it does for a visitor;
    // javaScriptEnabled: false still parses it as if scripts ran.
    const browser = await playwright.chromium.launch({ args: ["--blink-settings=scriptEnabled=false"] });
    try {
      const page = await browser.newPage({ baseURL });
      await page.goto("/collection");
      await expect(page.locator(".noscript-note")).toBeVisible();
      await expect(page.locator(".noscript-note")).toContainText("CollectCollect Whisky needs JavaScript");
      // The pages are drawn on the server, so the seeded shelf still reads.
      await expect(page.getByRole("link", { name: /Springbank/ }).first()).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
