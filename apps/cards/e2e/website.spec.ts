import { documentedHeaders, expect, headerProblems, NONCE, test, watch, type Page } from "./fixtures";
import { addCardByHand, cardPhoto } from "./helpers";

/**
 * The card app as a website: its production build, served by its own server
 * with the headers it really sends, driven through the main flow in Chromium.
 * Every spec already fails on a policy violation, a page error or a request
 * that leaves the site (fixtures.ts); this one also holds every response to
 * the README's headers block and caching, the features the page may use to the
 * Permissions-Policy, and checks the safety net, the page without JavaScript,
 * the files a website answers at fixed addresses, and that the repository's
 * own files are not among them.
 */

const EXPECTED = documentedHeaders();
const launchArgs = (args: string[]) => ({ args, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });

/** Hold every response the page receives from this site to the README, and remember each page's nonce. */
function holdResponses(page: Page, origin: string, problems: string[], answeredByTest: (url: URL) => boolean = () => false) {
  const nonces = new Set<string>();
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin || response.fromServiceWorker() || answeredByTest(url)) return;
    problems.push(...headerProblems(response, EXPECTED));
    const cache = response.headers()["cache-control"] ?? "(none)";
    const type = response.request().resourceType();
    if (url.pathname.startsWith("/_next/static/")) {
      if (response.status() === 200 && cache !== "public, max-age=31536000, immutable") problems.push(`${url.pathname}: a hashed build file is cached as "${cache}"`);
    } else if (url.pathname.startsWith("/api/uploads/") && response.request().method() === "GET") {
      if (response.status() === 200 && cache !== "private, max-age=31536000, immutable") problems.push(`${url.pathname}: a photo is cached as "${cache}"`);
    } else if (type === "document" || url.pathname.startsWith("/api/")) {
      if (!/\bno-store\b/.test(cache)) problems.push(`${url.pathname}: a page or an API answer is cached as "${cache}"`);
    }
    if (type === "document") {
      const nonce = NONCE.exec(response.headers()["content-security-policy"] ?? "")?.[1];
      if (nonce && nonces.has(nonce)) problems.push(`${url.pathname}: a nonce used for an earlier page too`);
      if (nonce) nonces.add(nonce);
    }
  });
}

/** Every Permissions-Policy feature is one Chromium knows, and the page has exactly the ones the header leaves on. */
async function featureProblems(page: Page): Promise<string[]> {
  const features = await page.evaluate(() => {
    const policy = (document as unknown as { featurePolicy: { features(): string[]; allowedFeatures(): string[] } }).featurePolicy;
    return { known: policy.features(), allowed: policy.allowedFeatures() };
  });
  const problems: string[] = [];
  for (const entry of (EXPECTED.get("permissions-policy") ?? "").split(", ")) {
    const [feature = "", allowlist] = entry.split("=");
    if (!features.known.includes(feature)) problems.push(`Permissions-Policy names ${feature}, which Chromium does not recognise`);
    else if (features.allowed.includes(feature) !== (allowlist !== "()")) problems.push(`Permissions-Policy says ${entry}, but the page has ${feature} ${features.allowed.includes(feature) ? "on" : "off"}`);
  }
  return problems;
}

test.describe("the website", () => {
  test("the main flow, with every response carrying the README's headers and caching, and a fresh nonce for every page", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const origin = new URL(baseURL!).origin;
    const problems: string[] = [];
    holdResponses(page, origin, problems);

    expect((await page.goto("/"))?.status()).toBe(200);
    problems.push(...(await featureProblems(page)));

    // Add a card, then reach everything else through the app's own links, so
    // the framework loads its route chunks the way a visitor's browser does.
    const name = `Website Wartortle ${Date.now()}`;
    await addCardByHand(page, { name, set: "Base Set", number: "42", purchase: "12" });
    await page.goto("/collection");
    // A plain form: it reloads the page with the query, which form-action 'self' allows.
    await page.getByPlaceholder("Search name, set, number…").fill(name);
    await page.getByPlaceholder("Search name, set, number…").press("Enter");
    await expect(page).toHaveURL(/\/collection\?q=Website/);
    await page.getByRole("link", { name: new RegExp(name) }).first().click();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    const nav = page.getByRole("banner");
    for (const [link, heading] of [
      ["Sets", /^Sets/],
      ["Goals", /^Collecting goals/],
      ["Grading", /^Grading submissions/],
      ["Alerts", /^Alerts/],
      ["Report", /^Collection valuation/],
      ["Settings", /^Settings$/],
      ["Portfolio", /.+/],
    ] as const) {
      // "Alerts" carries the unread count in its name when there is one.
      await nav.getByRole("link", { name: new RegExp(`^${link}`) }).click();
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
    await nav.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await nav.getByRole("button", { name: "System" }).click();

    expect((await page.goto("/no-such-page"))?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not here" })).toBeVisible();

    // The started page shows no safety-net note, even once its grace period is over.
    await page.waitForTimeout(5_000);
    await expect(page.locator(".boot-note")).toHaveCount(0);

    expect(problems).toEqual([]);
  });

  test("a photo shows from the browser's own copy while it uploads, which img-src allows as blob:", async ({ page }) => {
    await page.goto("/add");
    // Held back, so the preview is on screen long enough to be looked at.
    await page.route("**/api/uploads", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.locator('input[type="file"]').first().setInputFiles(await cardPhoto(page, [30, 160, 90]));
    const preview = page.locator('img[src^="blob:"]').first();
    await expect(preview).toBeVisible();
    expect(await preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('img[src^="/api/uploads/"]').first()).toBeVisible();
  });

  test("the scan screen's camera previews and captures, granted to this page and no other feature", async ({ playwright, baseURL }) => {
    // A camera of Chromium's own making, which needs a browser launched for it.
    const browser = await playwright.chromium.launch(launchArgs(["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]));
    try {
      const context = await browser.newContext({ baseURL, permissions: ["camera"] });
      const problems: string[] = [];
      await watch(context, new URL(baseURL!).origin, problems);
      const page = await context.newPage();
      // The test answers identification itself (below); everything else is the server's.
      holdResponses(page, new URL(baseURL!).origin, problems, (url) => url.pathname.endsWith("/identify"));
      await page.goto("/scan");
      expect(await page.evaluate(() => (document as unknown as { featurePolicy: { allowsFeature(f: string): boolean } }).featurePolicy.allowsFeature("camera"))).toBe(true);
      // Identification would reach the model; this is about the camera.
      await page.route("**/api/scan-drafts/*/identify", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not in this test" }) }));
      await page.getByRole("button", { name: "Use camera" }).click();
      await page.waitForFunction(() => {
        const video = document.querySelector("video");
        return !!video && video.videoWidth > 0 && !video.paused;
      });
      const uploaded = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/uploads");
      await page.getByRole("button", { name: "Capture" }).click();
      const response = await uploaded;
      expect(response.status()).toBe(200);
      await page.getByRole("button", { name: "Stop camera" }).click();
      // Leave the shared collection's inbox as it was.
      const { draft } = (await response.json()) as { draft: { id: string } };
      await expect(async () => {
        const { drafts } = (await (await page.request.get("/api/scan-drafts")).json()) as { drafts: Array<{ id: string; revision: number; status: string }> };
        const latest = drafts.find((d) => d.id === draft.id);
        expect(latest?.status).not.toBe("identifying");
        expect((await page.request.post(`/api/scan-drafts/${draft.id}/discard`, { data: { revision: latest?.revision } })).ok()).toBe(true);
      }).toPass();
      expect(problems).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test("without JavaScript the page says what still works, and the search box still searches", async ({ playwright, baseURL }) => {
    // Scripting off in Blink itself, so <noscript> renders as it does for a
    // visitor; javaScriptEnabled: false still parses it as if scripts ran.
    const browser = await playwright.chromium.launch(launchArgs(["--blink-settings=scriptEnabled=false"]));
    try {
      const page = await browser.newPage({ baseURL });
      const refused: string[] = [];
      page.on("console", (message) => {
        if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
      });
      await page.goto("/collection");
      await expect(page.locator(".noscript-note")).toBeVisible();
      await expect(page.locator(".noscript-note")).toContainText("CollectCollect needs JavaScript");
      await page.getByPlaceholder("Search name, set, number…").fill("Wartortle");
      await page.getByPlaceholder("Search name, set, number…").press("Enter");
      await expect(page).toHaveURL(/\/collection\?q=Wartortle/);
      expect(refused).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  test("a page whose scripts fail or throw while starting says so, and one that starts never does", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const chunk = (url: URL) => url.pathname.startsWith("/_next/static/chunks/") && url.pathname.endsWith(".js");
    const guard = (url: URL) => url.pathname === "/guard.js";
    const later = (ms: number, then: (route: import("@playwright/test").Route) => Promise<void>) => async (route: import("@playwright/test").Route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await then(route);
    };
    const abort = (route: import("@playwright/test").Route) => route.abort();
    const throwing = (route: import("@playwright/test").Route) => route.fulfill({ contentType: "text/javascript", body: 'throw new Error("a script that fails while the app starts");' });
    const pass = (route: import("@playwright/test").Route) => route.continue();
    // "prompt": up by the time the page has loaded, which only the guard's
    // error listener can do; "late": within its grace period after load,
    // which is the check after load; "none": never, even once that has passed.
    type Case = [string, Array<[(url: URL) => boolean, (route: import("@playwright/test").Route) => Promise<void>]>, "prompt" | "late" | "none"];
    const cases: Case[] = [
      // After the guard is listening.
      ["fail to arrive", [[chunk, later(1_000, abort)]], "prompt"],
      ["throw", [[chunk, later(1_000, throwing)]], "prompt"],
      // Before it is listening: the check after load catches it.
      ["fail before the guard has arrived", [[chunk, abort], [guard, later(1_500, pass)]], "late"],
      // A healthy page the guard reaches only after it has started.
      ["start before the guard has arrived", [[guard, later(3_000, pass)]], "none"],
    ];
    for (const [how, routes, expected] of cases) {
      const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
      const page = await context.newPage();
      for (const [match, answer] of routes) await page.route(match, answer);
      await page.goto("/collection", { waitUntil: "load" });
      const note = page.getByRole("alert").filter({ hasText: "didn't finish loading" });
      if (expected === "prompt") {
        await expect(note, `a page whose scripts ${how}`).toBeVisible({ timeout: 1_000 });
      } else if (expected === "late") {
        await expect(note, `a page whose scripts ${how}`).toBeVisible({ timeout: 15_000 });
      } else {
        await page.waitForTimeout(5_000);
        await expect(note, `a page whose scripts ${how}`).toHaveCount(0);
      }
      if (expected !== "none") await expect(note.getByRole("button", { name: "Reload" })).toBeVisible();
      await context.close();
    }
  });

  test("the files a website answers at fixed addresses, under the same headers", async ({ request }) => {
    for (const [pathname, type, cache] of [
      ["/robots.txt", "text/plain", "public, max-age=0"],
      ["/.well-known/security.txt", "text/plain", "public, max-age=0"],
      ["/guard.js", "text/javascript", "no-cache"],
      ["/sw.js", "text/javascript", "no-cache"],
      ["/manifest.webmanifest", "application/manifest+json", "public, max-age=0, must-revalidate"],
      ["/icons/icon-192.png", "image/png", "public, max-age=0"],
    ] as const) {
      const res = await request.get(pathname);
      expect(res.status(), pathname).toBe(200);
      expect(res.headers()["content-type"]?.startsWith(type), `${pathname} is ${res.headers()["content-type"]}`).toBe(true);
      expect(res.headers()["cache-control"], pathname).toBe(cache);
      expect(headerProblems(res, EXPECTED), pathname).toEqual([]);
    }
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
    expect(await (await request.get("/.well-known/security.txt")).text()).toContain("Contact: https://github.com/Platteration/collectcollect/security/advisories/new");
  });

  test("the repository's own files are not part of the site", async ({ request }) => {
    for (const pathname of [
      "/README.md",
      "/package.json",
      "/package-lock.json",
      "/.env",
      "/.env.example",
      "/.git/config",
      "/.git/HEAD",
      "/next.config.ts",
      "/src/proxy.ts",
      "/src/app/layout.tsx",
      "/public/robots.txt",
      "/data/collectcollect.db",
      "/.next/BUILD_ID",
      "/_next/BUILD_ID",
      "/_next/server/app/page.js",
      "/_next/static/..%2f..%2fpackage.json",
      "/%2e%2e/package.json",
      "/api/uploads/..%2f..%2fpackage.json",
      "/.well-known/../package.json",
    ]) {
      const res = await request.get(pathname, { maxRedirects: 0 });
      expect(res.status(), pathname).toBe(404);
      const body = await res.text();
      for (const leak of ['"name": "collectcollect"', "@collectcollect", "export const proxy", "[core]", "ref: refs/"]) expect(body, `${pathname} gave away ${leak}`).not.toContain(leak);
    }
  });
});
