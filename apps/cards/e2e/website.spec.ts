import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { documentedHeaders, expect, headerProblems, NONCE, test, unwatchedContext, watch, type Page } from "./fixtures";
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

/** Every page the app has, read off the file system, so a page added without a place in the walk below fails it. */
function pageRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${route}/${entry.name}`);
      else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(entry.name)) routes.push(route || "/");
    }
  };
  walk(path.join(import.meta.dirname, "../src/app"), "");
  return routes.sort();
}

/** A page of another origin on this machine, answered by `body`, for framing the app from. */
async function serve(body: (url: URL) => string): Promise<{ origin: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(body(new URL(request.url ?? "/", "http://127.0.0.1")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Set by Started (packages/core/src/components/Started.tsx) once React has the page. */
const started = () => (window as unknown as { __collectcollectStarted?: boolean }).__collectcollectStarted === true;

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

  test("every page the app has starts under the policy with the README's headers, and the manifest is one it may read", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const origin = new URL(baseURL!).origin;
    const problems: string[] = [];
    holdResponses(page, origin, problems);

    const stamp = Date.now();
    const set = `Every Page Set ${stamp}`;
    const made = await page.request.post("/api/cards", { data: { game: "pokemon", name: `Every Page Eevee ${stamp}`, setName: set, cardNumber: "133" } });
    expect(made.ok(), await made.text()).toBe(true);
    const card = ((await made.json()) as { card: { id: number } }).card.id;
    const batch = await page.request.post("/api/submissions", { data: { company: "PSA", name: `Every page ${stamp}` } });
    expect(batch.ok(), await batch.text()).toBe(true);
    const submission = ((await batch.json()) as { submission: { id: number } }).submission.id;
    try {
      // The address each page is drawn at here; a page missing from this list fails the test.
      const pages: Record<string, string | null> = {
        "/": "/",
        "/add": "/add",
        "/alerts": "/alerts",
        "/cards/[id]": `/cards/${card}`,
        "/collection": "/collection",
        "/goals": "/goals",
        "/import": "/import",
        // On this open server it sends a visitor home; auth.spec.ts draws it behind the password.
        "/login": null,
        "/offline": "/offline",
        "/report": "/report",
        "/scan": "/scan",
        "/sets": "/sets",
        "/sets/[game]/[name]": `/sets/pokemon/${encodeURIComponent(set)}`,
        "/settings": "/settings",
        "/submissions": "/submissions",
        "/submissions/[id]": `/submissions/${submission}`,
      };
      expect(Object.keys(pages).sort()).toEqual(pageRoutes());
      for (const address of Object.values(pages)) {
        if (address === null) continue;
        expect((await page.goto(address))?.status(), address).toBe(200);
        // React has the page, so every script it needed was allowed to run.
        await page.waitForFunction(started, undefined, { timeout: 15_000 });
      }

      // The browser reads the web manifest only when asked (installing, say), which
      // manifest-src governs: ask for it the way an install would.
      await page.goto("/");
      const cdp = await page.context().newCDPSession(page);
      const manifest = await cdp.send("Page.getAppManifest", {});
      expect(manifest.errors).toEqual([]);
      expect(manifest.url).toBe(`${origin}/manifest.webmanifest`);
      expect((JSON.parse(manifest.data ?? "{}") as { name?: string }).name).toBe("CollectCollect");
      await cdp.detach();
    } finally {
      await page.request.delete(`/api/submissions/${submission}`);
      await page.request.delete(`/api/cards/${card}`);
    }
    expect(problems).toEqual([]);
  });

  test("every kind of answer carries the headers, but the two Next makes before the proxy runs", async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const answers: Array<{ method?: string; path: string; status?: number; location?: string; headers?: Record<string, string>; data?: string }> = [
      // A trailing slash is put right by the proxy, the query kept.
      { path: "/collection/", status: 308, location: "/collection" },
      { path: "/collection/?q=Wartortle", status: 308, location: "/collection?q=Wartortle" },
      { path: "/api/health/", status: 308, location: "/api/health" },
      { method: "HEAD", path: "/collection", status: 200 },
      { method: "OPTIONS", path: "/collection" },
      { path: "/_next/static/chunks/no-such-chunk.js", status: 404 },
      { path: "/api/no-such-route", status: 404 },
      { path: "/%E0%A4%A" },
      { method: "POST", path: "/api/cards", status: 415, headers: { "Content-Type": "text/plain" }, data: "{}" },
      { method: "DELETE", path: "/api/cards/999999999" },
    ];
    for (const answer of answers) {
      const res = await request.fetch(`${origin}${answer.path}`, { method: answer.method ?? "GET", headers: answer.headers, data: answer.data, maxRedirects: 0 });
      const label = `${answer.method ?? "GET"} ${answer.path}`;
      if (answer.status !== undefined) expect(res.status(), label).toBe(answer.status);
      if (answer.location !== undefined) expect(res.headers()["location"], label).toBe(answer.location);
      expect(headerProblems(res, EXPECTED), label).toEqual([]);
    }

    // Next's own two, made before the proxy runs (README, "The website"). An address
    // with a repeated slash or a backslash is redirected to the one without, and a
    // method the fetch standard forbids is answered 500 before a request can be built
    // for the proxy. Neither carries anything a browser draws, and no page can make a
    // browser send the second. When this fails, Next has changed: say so in the README.
    const doubled = await request.fetch(`${origin}//collection`, { maxRedirects: 0 });
    expect(doubled.status()).toBe(308);
    expect(doubled.headers()["location"]).toBe("/collection");
    expect(doubled.headers()["content-security-policy"]).toBeUndefined();
    const traced = await request.fetch(`${origin}/`, { method: "TRACE" });
    expect(traced.status()).toBe(500);
    expect(traced.headers()["content-type"]).toBe("text/plain");
    expect(traced.headers()["content-security-policy"]).toBeUndefined();
  });

  test("a context a test makes for itself is held to the same rules as its own", async ({ browser, baseURL, siteRules }) => {
    // fixtures.ts watches every context a test makes; this one breaks a rule on purpose
    // and reads the report the fixture would otherwise fail the test on.
    const origin = new URL(baseURL!).origin;
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await page.route(`${origin}/rules-probe`, (route) =>
        route.fulfill({ status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'" }, body: "<p>probe</p><script>1</script>" }),
      );
      await page.goto("/rules-probe");
      await expect.poll(() => siteRules.join("\n")).toContain("CSP violation: script-src-elem blocked inline on " + `${origin}/rules-probe`);
    } finally {
      await context.close();
    }
    siteRules.splice(0);
  });

  test("the policy refuses what it is there to refuse", async ({ browser, baseURL, request }) => {
    // A page of this origin served under the policy a real page gets, carrying what an
    // injection would: everything here is refused by the directive named for it, and
    // the one script with the response's nonce runs to count. Its own context, since
    // every refusal is a violation by design.
    const origin = new URL(baseURL!).origin;
    const csp = (await request.get("/collection")).headers()["content-security-policy"] ?? "";
    const nonce = NONCE.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    const probe = `<!doctype html><html><head>
<script nonce="${nonce}">
  window.__refused = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    const what = e.effectiveDirective + (e.blockedURI === "inline" ? " inline" : " address");
    // Chromium reports a refused <base> once or twice; each refusal counts once.
    if (!window.__refused.includes(what)) window.__refused.push(what);
  });
</script>
<base href="https://example.com/">
<script>window.__inline = true;</script>
<script src="/guard.js"></script>
<style>body { color: red }</style>
</head><body>
<img src="http://example.com/picture.png" alt="">
<object data="/robots.txt"></object>
<iframe src="/robots.txt"></iframe>
<form id="away" action="https://example.com/" method="post"><input name="x" value="y"></form>
<script nonce="${nonce}">
  fetch("https://example.com/").catch(() => {});
  document.getElementById("away").submit();
</script>
</body></html>`;
    const context = await unwatchedContext(browser, { baseURL, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await page.route(`${origin}/policy-probe`, (route) =>
        route.fulfill({ status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp }, body: probe }),
      );
      // A refused <object> and form leave the load event pending; the polls below wait instead.
      await page.goto("/policy-probe", { waitUntil: "commit" });
      await expect.poll(() => page.evaluate(() => (window as unknown as { __refused: string[] }).__refused.length)).toBe(9);
      const refused = await page.evaluate(() => (window as unknown as { __refused: string[] }).__refused.slice().sort());
      // The inline script, and this origin's own file without the nonce: 'strict-dynamic'
      // makes the browser ignore 'self', so injected markup cannot load even that.
      expect(refused).toEqual([
        "base-uri address",
        "connect-src address",
        "form-action address",
        "frame-src address",
        "img-src address",
        "object-src address",
        "script-src-elem address",
        "script-src-elem inline",
        "style-src-elem inline",
      ]);
      expect(await page.evaluate(() => "__inline" in window || "collectcollectGuard" in window)).toBe(false);
      expect(new URL(page.url()).pathname).toBe("/policy-probe");

      // And no other origin may frame a page. Both framing pages and the control are
      // real loopback servers, as the app is (a page Playwright answers itself has no
      // address, and Chromium refuses its frames of a loopback one whatever their
      // headers): a frame of a page without the app's headers loads, the app's does not.
      const framer = await serve((url) => `<iframe src="${url.searchParams.get("src")}"></iframe>`);
      const plain = await serve(() => "<p>framed</p>");
      try {
        const child = () => page.frames().find((frame) => frame !== page.mainFrame())?.url();
        await page.goto(`${framer.origin}/?src=${encodeURIComponent(`${plain.origin}/`)}`);
        await expect.poll(child).toBe(`${plain.origin}/`);
        await page.goto(`${framer.origin}/?src=${encodeURIComponent(`${origin}/collection`)}`);
        await expect.poll(child).toBe("chrome-error://chromewebdata/");
      } finally {
        await framer.close();
        await plain.close();
      }
    } finally {
      await context.close();
    }
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
      const context = await unwatchedContext(browser, { baseURL, serviceWorkers: "block" });
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
