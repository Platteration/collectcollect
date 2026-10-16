import { expect, test, unwatchedContext, watch } from "./fixtures";

/**
 * Every other spec is held to the website's rules by the watch in fixtures.ts,
 * so the watch is shown here to see what it should: each rule broken on
 * purpose, in a context outside the rules, with what it reports read back. A
 * watch that stopped seeing would otherwise pass every spec in silence.
 */
test.describe("the website's rules, held in every test", () => {
  /** A page in a context outside the rules, watched by hand so that what it reports can be read. */
  async function probe(browser: Parameters<typeof unwatchedContext>[0], baseURL: string | undefined) {
    const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
    const context = await unwatchedContext(browser);
    const problems: string[] = [];
    await watch(context, origin, problems);
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    return { context, page, problems };
  }

  // An image from another host, which img-src 'self' refuses before any request is made. (Not a script:
  // code Playwright evaluates is exempt from the policy, and an inline script it adds to the page would
  // run under 'strict-dynamic' all the same.)
  const loadAForeignImage = () => {
    const image = new Image();
    image.src = "https://elsewhere.example/probe.png";
    document.body.append(image);
  };

  test("a page that behaves reports nothing", async ({ browser, baseURL }) => {
    const { context, problems } = await probe(browser, baseURL);
    expect(problems).toEqual([]);
    await context.close();
  });

  test("a load the policy refuses is reported", async ({ browser, baseURL }) => {
    const { context, page, problems } = await probe(browser, baseURL);
    await page.evaluate(loadAForeignImage);
    await expect.poll(() => problems.filter((p) => /^CSP violation: img-src blocked https:\/\/elsewhere\.example\/probe\.png on /.test(p)).length).toBeGreaterThan(0);
    await context.close();
  });

  test("an uncaught exception is reported", async ({ browser, baseURL }) => {
    const { context, page, problems } = await probe(browser, baseURL);
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("probe exception");
      });
    });
    await expect.poll(() => problems.filter((p) => /^uncaught Error on \S+: probe exception$/.test(p)).length).toBe(1);
    await context.close();
  });

  test("a request that leaves the site is reported", async ({ browser, baseURL }) => {
    const { context, page, problems } = await probe(browser, baseURL);
    // Answered here, so nothing leaves the machine; the watch sees the request all the same.
    await context.route("https://elsewhere.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>elsewhere</title>" }));
    await page.goto("https://elsewhere.example/");
    expect(problems).toContain("a request left the site: GET document https://elsewhere.example/");
    await context.close();
  });

  test("a test whose page breaks the policy fails", async ({ page, siteRules }) => {
    // The fixture itself, not the watch: this test is expected to fail, and Playwright
    // reports it as failed if the fixture lets what its page did pass.
    test.fail(true, "siteRules fails a test whose page breaks the policy");
    await page.goto("/");
    await page.evaluate(loadAForeignImage);
    // Recorded before the test ends, so that what is left to the fixture is its verdict on it.
    await expect.poll(() => siteRules.length).toBeGreaterThan(0);
  });
});
