import http from "node:http";
import type { Page } from "@playwright/test";
import { documentedHeaders, expect, GOOGLE_SIGN_IN, headerProblems, test, unwatchedContext, watch } from "./fixtures";
import { authorize, E2E_ACCOUNTS, type FakeAccount } from "../../../scripts/fake-google.mjs";
import { E2E_PASSWORD } from "./data-dir";

/**
 * Google's sign-in page, played by the test (scripts/fake-google.mjs): the
 * account agrees, and Google sends the browser back to the app. The server's
 * half, the token endpoint and the keys, is the fake scripts/e2e-google.mjs
 * puts in front of the server's fetch.
 */
async function googleSignsIn(page: Page, account: FakeAccount) {
  // At the protocol, not through page.route: the browser reaches Google's page
  // by the redirect the app's start route answers with, and Playwright hands a
  // redirected request straight to the network, route or no route. Chromium's
  // own interception pauses it like any other.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://accounts.google.com/*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", (event) => {
    let answer: { responseCode: number; responseHeaders: Array<{ name: string; value: string }> };
    try {
      answer = { responseCode: 302, responseHeaders: [{ name: "Location", value: authorize(event.request.url, account) }] };
    } catch (error) {
      // A request Google would refuse to show: the test fails on the page it lands on.
      answer = { responseCode: 400, responseHeaders: [{ name: "X-Refused", value: String(error) }] };
    }
    void cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, ...answer, body: "" });
  });
}

test.describe("password gate", () => {
  test("every page redirects to the login form until the password is given", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Wrong password")).toBeVisible();

    await page.getByLabel("Password").fill("e2e-secret");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Portfolio" })).toBeVisible();
  });

  test("a login link cannot send the owner to another site once they sign in", async ({ page, baseURL }) => {
    // Dot segments resolve on this origin to a path starting `//`, which the
    // browser then reads as another host: this link once signed the owner in
    // and left them on evil.example, a page free to ask for the password again.
    // Answered here so that, were it followed, nothing would leave the machine;
    // the fixture fails the test on the request all the same.
    await page.route(/^https?:\/\/evil\.example\//, (route) => route.fulfill({ contentType: "text/html", body: "elsewhere" }));
    await page.goto(`/login?next=${encodeURIComponent("/.//evil.example/sign-in-again")}`);
    await page.getByLabel("Password").fill("e2e-secret");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("link", { name: "Portfolio" })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(String(baseURL)).origin);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("the login page shows a stranger none of the app", async ({ page }) => {
    // No nav that bounces straight back to this page, no unread-alert count,
    // no Sign out and no Add: the chrome is for someone signed in.
    await page.goto("/login");
    await expect(page.getByLabel("Password")).toBeVisible();
    for (const name of ["Portfolio", "Collection", "Alerts", "Settings"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^\+ Add/ })).toHaveCount(0);
  });

  test("an API call without a session is refused", async ({ request }) => {
    expect((await request.get("/api/cards")).status()).toBe(401);
  });

  test("the refusal and the login redirect carry the security headers too", async ({ request }) => {
    // Every branch of the proxy is a document a browser acts on, not only the
    // pass-through; a 401 or a redirect without the policy would be the one
    // response an attacker could frame. And none names the framework.
    const refused = await request.get("/api/cards");
    expect(refused.status()).toBe(401);
    expect(refused.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(refused.headers()["x-powered-by"]).toBeUndefined();
    const redirected = await request.get("/collection", { maxRedirects: 0 });
    expect(redirected.status()).toBe(307);
    expect(redirected.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(redirected.headers()["x-content-type-options"]).toBe("nosniff");
    expect(redirected.headers()["x-powered-by"]).toBeUndefined();
  });

  test("the health check answers without a session, and gives nothing away", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string; database: boolean };
    expect(body).toMatchObject({ ok: true, app: "collectcollect" });
    expect(typeof body.database).toBe("boolean");
    expect(body).not.toHaveProperty("dataDir");
    // Every response, including this one, carries the security headers.
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("signing out everywhere ends the other browser's session too", async ({ browser }) => {
    const phone = await browser.newContext();
    const laptop = await browser.newContext();
    try {
      for (const context of [phone, laptop]) {
        const page = await context.newPage();
        await page.goto("/login");
        await page.getByLabel("Password").fill("e2e-secret");
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL(/\/$/);
        await page.close();
      }
      // Both signed in; the laptop is left where it is.
      expect((await laptop.request.get("/api/health")).status()).toBe(200);
      const laptopPage = await laptop.newPage();
      await laptopPage.goto("/collection");
      await expect(laptopPage).toHaveURL(/\/collection$/);

      // The phone ends every session from Settings.
      const phonePage = await phone.newPage();
      await phonePage.goto("/settings");
      phonePage.once("dialog", (d) => d.accept());
      await phonePage.getByRole("button", { name: "Sign out everywhere" }).click();
      await expect(phonePage).toHaveURL(/\/login/);

      // The laptop's cookie is no longer honoured, on the API or the pages.
      expect((await laptop.request.get("/api/settings")).status()).toBe(401);
      await laptopPage.goto("/collection");
      await expect(laptopPage).toHaveURL(/\/login/);
    } finally {
      await phone.close();
      await laptop.close();
    }
  });

  test("signing out sends you back to the login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password").fill("e2e-secret");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Signing in is a full navigation, and the server-rendered nav is visible
    // before the scripts that wire its buttons have run: a click in that gap
    // sends nothing (it did, one run in four). waitForURL waits for the load
    // event, by which time React is listening and replays a click it gets.
    await page.waitForURL("/");
    await expect(page.getByRole("link", { name: "Collection" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/collection");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("sign-in with Google beside the password", () => {
  // This server also has APP_URL, a Google client and one account on its list
  // (playwright.config.ts); the password still works as it did (above).
  test("the owner's account signs in, lands on the page asked for, and signs out like any session", async ({ page }) => {
    await googleSignsIn(page, E2E_ACCOUNTS.owner);
    await page.goto("/collection");
    await expect(page).toHaveURL(/\/login\?next=%2Fcollection$/);
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.getByRole("link", { name: "Sign in with Google" }).click();
    await page.waitForURL(/\/collection$/);
    await expect(page.getByPlaceholder("Search name, set, number…")).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByText(/^A password is set and sign-in with Google is on, and every device signed in stays signed in for 30 days/)).toBeVisible();
    // What leaves the server says Google is among it.
    await expect(page.locator("footer").filter({ has: page.getByRole("heading", { name: "About" }) })).toContainText("Signing in with Google takes your browser to Google, which learns of the sign-in, and this server then asks Google which account it was. Nothing else leaves this server.");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/collection");
    await expect(page).toHaveURL(/\/login/);
    expect((await page.request.get("/api/cards")).status()).toBe(401);
  });

  test("an account not on the list is turned back to the login page, told once, and signed in nowhere", async ({ page }) => {
    await googleSignsIn(page, E2E_ACCOUNTS.stranger);
    await page.goto("/login");
    await page.getByRole("link", { name: "Sign in with Google" }).click();
    await expect(page.getByText("Sign-in didn't complete.")).toBeVisible();
    // Said once: the address no longer carries it, so a reload does not say it again.
    await expect(page).toHaveURL(/\/login$/);
    await page.reload();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByText("Sign-in didn't complete.")).toHaveCount(0);
    expect((await page.request.get("/api/cards")).status()).toBe(401);
  });

  test("the suite's watch lets Google's sign-in page in as the page itself, never in a frame", async ({ browser }) => {
    // The rules every page is held to (fixtures.ts), applied to a context of the
    // test's own: a page framing Google's sign-in would be a regression the
    // browser and Google refuse, and the watch has to see it too.
    const context = await unwatchedContext(browser);
    try {
      const problems: string[] = [];
      await watch(context, "http://127.0.0.1:9", problems);
      const page = await context.newPage();
      await page.route((url) => url.href.startsWith(GOOGLE_SIGN_IN), (route) => route.fulfill({ contentType: "text/html", body: "<p>Google</p>" }));
      await page.setContent(`<iframe src="${GOOGLE_SIGN_IN}?client_id=framed"></iframe>`);
      await expect.poll(() => problems).toEqual([`a request left the site: GET document ${GOOGLE_SIGN_IN}?client_id=framed`]);
      await page.goto(`${GOOGLE_SIGN_IN}?client_id=top`);
      expect(problems).toHaveLength(1);
    } finally {
      await context.close();
    }
  });
});

test.describe("the website, behind the password", () => {
  test("robots.txt, security.txt, the safety net and the framework's files answer without a session, under the same headers", async ({ request }) => {
    const login = await (await request.get("/login")).text();
    const chunk = /src="(\/_next\/static\/chunks\/[^"]+\.js)"/.exec(login)?.[1];
    expect(chunk).toBeTruthy();
    for (const pathname of ["/robots.txt", "/.well-known/security.txt", "/guard.js", chunk!]) {
      const res = await request.get(pathname, { maxRedirects: 0 });
      expect(res.status(), pathname).toBe(200);
      expect(headerProblems(res, documentedHeaders()), pathname).toEqual([]);
    }
    // Nothing else beside them: another file in the same folder still needs the password.
    expect((await request.get("/.well-known/other.txt", { maxRedirects: 0 })).status()).toBe(307);
  });

  test("the login page starts under the policy, and its safety net stays down", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.waitForTimeout(5_000);
    await expect(page.locator(".boot-note")).toHaveCount(0);
  });

  test("without JavaScript, a password typed into the login form never leaves the page", async ({ playwright, baseURL }) => {
    const browser = await playwright.chromium.launch({
      args: ["--blink-settings=scriptEnabled=false"],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    });
    try {
      const page = await browser.newPage({ baseURL });
      const sent: string[] = [];
      page.on("request", (r) => sent.push(r.url()));
      await page.goto("/login");
      await expect(page.locator(".noscript-note")).toBeVisible();
      await page.getByLabel("Password").fill("typed-before-any-script");
      await page.getByLabel("Password").press("Enter");
      await page.waitForTimeout(1_000);
      expect(new URL(page.url()).pathname).toBe("/login");
      expect(sent.filter((url) => url.includes("typed-before-any-script"))).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});

test.describe("an https address beside a home network's names", () => {
  // This server is told it is reached at https://cards.example, through a
  // proxy it was not told about, and answers to cardbox.lan and 127.0.0.1 as
  // well (playwright.config.ts): README's advice to keep listing the names an
  // owner still uses at home. Neither app serves TLS, so those are plain http,
  // and what only https may carry goes to the domain alone.

  /** An answer as the server gives it, Host and all, with nothing in between. */
  const raw = (baseURL: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const { hostname, port } = new URL(baseURL);
      const req = http.request({ host: hostname, port, path, method: init.method ?? "GET", headers: init.headers }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      });
      req.on("error", reject);
      req.end(init.body);
    });
  const promisesHttps = (headers: http.IncomingHttpHeaders) => ({
    hsts: headers["strict-transport-security"] ?? null,
    upgrade: String(headers["content-security-policy"]).includes("upgrade-insecure-requests"),
  });

  test("the domain's answers promise https; the home names', and a forwarded protocol nobody declared, do not", async ({ baseURL }) => {
    const { port } = new URL(baseURL!);
    const domain = await raw(baseURL!, "/login", { headers: { host: "cards.example" } });
    expect(domain.status).toBe(200);
    expect(promisesHttps(domain.headers)).toEqual({ hsts: "max-age=31536000; includeSubDomains", upgrade: true });
    // The server writes https into the request's URL whenever X-Forwarded-Proto
    // so much as contains it, from anyone; with no proxy declared it is believed nowhere.
    const plain: Array<Record<string, string>> = [{ host: `cardbox.lan:${port}` }, { host: `127.0.0.1:${port}` }, { "x-forwarded-proto": "https" }, { "x-forwarded-proto": "https, http" }];
    for (const headers of plain) {
      const answer = await raw(baseURL!, "/login", { headers });
      expect(answer.status, JSON.stringify(headers)).toBe(200);
      expect(promisesHttps(answer.headers), JSON.stringify(headers)).toEqual({ hsts: null, upgrade: false });
    }
    const signIn = (headers: Record<string, string>) =>
      raw(baseURL!, "/api/auth", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ password: "e2e-secret" }) });
    const cookie = await signIn({ "x-forwarded-proto": "https" });
    expect(cookie.status).toBe(200);
    expect(String(cookie.headers["set-cookie"])).not.toMatch(/;\s*secure/i);
    // A write whose page claims https on a plain-http name is another origin's.
    expect((await signIn({ "x-forwarded-proto": "https", origin: `https://127.0.0.1:${port}` })).status).toBe(403);
  });

  test("a home name keeps working over plain http: styled, scripted, and its writes accepted", async ({ playwright, baseURL }) => {
    // Sent the upgrade, Chromium asked https://cardbox.lan for every script,
    // stylesheet and font, got nothing, and drew the page bare with no safety
    // net; and every write from the page was refused as cross-site.
    const lan = `http://cardbox.lan:${new URL(baseURL!).port}`;
    const browser = await playwright.chromium.launch({
      args: ["--host-resolver-rules=MAP cardbox.lan 127.0.0.1"],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    });
    try {
      const context = await browser.newContext({ baseURL: lan });
      const problems: string[] = [];
      await watch(context, lan, problems);
      const page = await context.newPage();
      page.on("response", (response) => {
        if (new URL(response.url()).origin === lan && !response.fromServiceWorker()) problems.push(...headerProblems(response, documentedHeaders()));
      });
      await page.goto("/login");
      await page.getByLabel("Password").fill("e2e-secret");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(`${lan}/`);
      await expect(page.getByRole("link", { name: "Collection" })).toBeVisible();
      // The stylesheet arrived: the header is laid out, not the browser's default block.
      expect(await page.evaluate(() => getComputedStyle(document.body).margin)).toBe("0px");
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator(".boot-note")).toHaveCount(0);
      expect(problems).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});

test.describe("on a phone", () => {
  test("Sign out is a 44 px target on touch, and the header still fits at 360 px", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    const box = (await signOut.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // With Sign out beside the theme buttons the controls no longer fit one row; they wrap, none cut off.
    const spill = await page.evaluate(() => [...document.querySelectorAll("header :is(button, a, summary):not(.cc-palette-panel *)")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > 360.5; })
      .map((el) => el.textContent));
    expect(spill).toEqual([]);
    expect(await page.evaluate(() => document.querySelector("header")!.scrollWidth)).toBeLessThanOrEqual(360);
    // On one row, not a third row for the last of them: the theme buttons, Sign out and + Add are level.
    const centres = await page.evaluate(() => ["Light", "Sign out", "+ Add"].map((name) => {
      const el = [...document.querySelectorAll("header button, header a")].find((e) => e.getAttribute("aria-label") === name || e.textContent?.trim().startsWith(name))!;
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    }));
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(8);

    await signOut.click();
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
