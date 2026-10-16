import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * The website's rules, held in every test.
 *
 * Every spec imports `test` from here, so every page any test drives fails it
 * on a content security policy violation (the `securitypolicyviolation` event
 * in the page and the browser's console report), on an uncaught exception, and
 * on a request that leaves this site. A context a test makes for itself with
 * `browser.newContext()` is held to the same rules; only `unwatchedContext`
 * makes one that is not, for a test whose pages break them on purpose
 * (`site-rules.spec.ts`).
 *
 * Cards and skins hold their suites to the same rules in their own
 * `e2e/fixtures.ts`. What this app's pages may load from elsewhere is nothing:
 * its proxy (`src/proxy.ts`) names no image source, so a request to another
 * host is a defect. A source added there is allowed here in the same change.
 */

/** Report what goes wrong in every page of a context into `problems`. */
export async function watch(context: BrowserContext, origin: string, problems: string[]): Promise<void> {
  await context.exposeBinding("__reportViolation", (_source, v: { directive: string; blocked: string; document: string; sample: string }) => {
    problems.push(`CSP violation: ${v.directive} blocked ${v.blocked || "(inline)"} on ${v.document}${v.sample ? ` (${v.sample})` : ""}`);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __reportViolation(v: object): void }).__reportViolation({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        document: e.documentURI,
        sample: e.sample,
      });
    });
  });
  const attach = (page: Page) => {
    page.on("pageerror", (error) => problems.push(`uncaught ${error.name} on ${page.url()}: ${error.message}`));
    page.on("console", (message) => {
      if (/Content Security Policy|Permissions[- ]Policy|Trusted Type|Refused to/i.test(message.text())) problems.push(`console ${message.type()}: ${message.text()}`);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      // blob: and data: addresses are the page's own; only the network is the site's edge.
      if (!/^(https?|wss?):$/.test(url.protocol) || url.origin === origin) return;
      problems.push(`a request left the site: ${request.method()} ${request.resourceType()} ${url.href}`);
    });
  };
  context.pages().forEach(attach);
  context.on("page", attach);
}

/** The browser's own `newContext`, while a test has it, for `unwatchedContext`. */
const plainNewContext = new WeakMap<Browser, Browser["newContext"]>();

/**
 * A context outside the rules, for the few tests whose pages break them on
 * purpose: the probe that shows the watch catching what it should. Every other
 * context is watched.
 */
export function unwatchedContext(browser: Browser, options?: Parameters<Browser["newContext"]>[0]): Promise<BrowserContext> {
  return (plainNewContext.get(browser) ?? browser.newContext.bind(browser))(options);
}

export const test = base.extend<{ siteRules: string[] }>({
  siteRules: [
    // The second argument is Playwright's `use`, named otherwise because the React
    // hooks lint takes a call to `use` inside a try for React's.
    async ({ context, baseURL, browser }, provide) => {
      const problems: string[] = [];
      const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
      await watch(context, origin, problems);
      // A context the test makes for itself (another colour scheme, a phone, a
      // second browser signed in) is held to the same rules as its own.
      const newContext = browser.newContext;
      const plain = newContext.bind(browser);
      plainNewContext.set(browser, plain);
      browser.newContext = async (options) => {
        const made = await plain(options);
        await watch(made, origin, problems);
        return made;
      };
      try {
        await provide(problems);
      } finally {
        browser.newContext = newContext;
        plainNewContext.delete(browser);
      }
      expect(problems, "policy violations, page errors and requests that left the site").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
