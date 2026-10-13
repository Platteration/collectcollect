import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Browser, type BrowserContext, type Page, type Request } from "@playwright/test";

/**
 * The website's rules, held in every test.
 *
 * Every spec imports `test` from here, so every page any test drives fails it
 * on a content security policy violation (the `securitypolicyviolation` event
 * in the page and the browser's console report), on an uncaught exception, and
 * on a request that leaves this site other than an image the policy allows
 * (or the one navigation to Google's sign-in page, which the suite answers).
 * The policy was measured this way: a source something real needs cannot be
 * missing without some test going red. A context a test makes for itself with
 * `browser.newContext()` is held to the same rules; only `unwatchedContext`
 * makes one that is not, for a test whose pages break them on purpose.
 * `website.spec.ts` holds the headers themselves to the README.
 */

/** Which app's block of the README this suite reads. */
export const APP = "skins";

/**
 * Item images come from Steam's two image hosts, as img-src says, and nothing
 * else does. And one page is visited: Google's sign-in page, at that one
 * address and as the page itself, never in a frame, which is how sign-in with
 * Google starts; the suite answers it itself (googleSignsIn), so nothing
 * reaches Google.
 */
const STEAM_IMAGES = new Set(["https://community.cloudflare.steamstatic.com", "https://steamcommunity-a.akamaihd.net"]);
export function allowedOutside(request: Request): boolean {
  const url = new URL(request.url());
  if (`${url.origin}${url.pathname}` === GOOGLE_SIGN_IN) return request.resourceType() === "document" && request.isNavigationRequest() && topLevel(request);
  return request.resourceType() === "image" && STEAM_IMAGES.has(url.origin);
}

export const GOOGLE_SIGN_IN = "https://accounts.google.com/o/oauth2/v2/auth";

/** Whether a request is for the page itself, not for a frame inside it (a service worker's request has no frame). */
function topLevel(request: Request): boolean {
  try {
    return request.frame().parentFrame() === null;
  } catch {
    return false;
  }
}

/**
 * The headers as the README writes them for this app (lower-case names), for
 * an answer over plain http as the suite's servers give: less HSTS and
 * `upgrade-insecure-requests`, which the README says go out over https only.
 * `{nonce}` stands where each response's nonce goes.
 */
export function documentedHeaders(): Map<string, string> {
  const readme = fs.readFileSync(path.join(import.meta.dirname, "../../../README.md"), "utf8");
  const block = new RegExp(`<!-- headers:${APP}:begin -->\\s*\`\`\`text\\n([\\s\\S]*?)\`\`\`\\s*<!-- headers:${APP}:end -->`).exec(readme);
  if (!block?.[1]) throw new Error(`README.md has no headers block for ${APP}`);
  const headers = new Map<string, string>();
  for (const line of block[1].split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf(": ");
    headers.set(line.slice(0, at).toLowerCase(), line.slice(at + 2));
  }
  headers.delete("strict-transport-security");
  const csp = headers.get("content-security-policy") ?? "";
  headers.set("content-security-policy", csp.split("; ").filter((d) => d !== "upgrade-insecure-requests").join("; "));
  return headers;
}

export const NONCE = /'nonce-([A-Za-z0-9+/=]+)'/;

/** A response from the browser or from `page.request`: both say where they came from and what they carried. */
interface Answer {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
}

/**
 * The ways a response from this site can fall short of the README: a header
 * missing or different, HSTS over plain http. Next's image optimiser sets a
 * stricter policy of its own on what it answers, which is all it differs in.
 */
export function headerProblems(response: Answer, expected = documentedHeaders()): string[] {
  const url = new URL(response.url());
  const got = response.headers();
  const problems: string[] = [];
  for (const [name, value] of expected) {
    const actual = got[name];
    if (actual === undefined) problems.push(`${response.status()} ${url.pathname} has no ${name}`);
    else if (name === "content-security-policy") {
      if (url.pathname === "/_next/image") continue;
      const nonce = NONCE.exec(actual);
      if (!nonce) problems.push(`${url.pathname}: the policy carries no nonce: ${actual}`);
      else if (actual.replace(nonce[0], "'nonce-{nonce}'") !== value) problems.push(`${url.pathname}: the policy is not the README's:\n  ${actual}\n  ${value}`);
    } else if (actual !== value) problems.push(`${url.pathname}: ${name} is "${actual}", the README says "${value}"`);
  }
  if (got["strict-transport-security"] !== undefined) problems.push(`${url.pathname}: HSTS announced over plain http`);
  if (got["x-powered-by"] !== undefined) problems.push(`${url.pathname}: names its framework`);
  return problems;
}

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
      if (!/^(https?|wss?):$/.test(url.protocol) || url.origin === origin) return;
      if (!allowedOutside(request)) problems.push(`a request left the site: ${request.method()} ${request.resourceType()} ${url.href}`);
    });
  };
  context.pages().forEach(attach);
  context.on("page", attach);
}

/** The browser's own `newContext`, while a test has it, for `unwatchedContext`. */
const plainNewContext = new WeakMap<Browser, Browser["newContext"]>();

/**
 * A context outside the rules, for the few tests whose pages break them on
 * purpose: the safety net's failing and throwing scripts, and the probe that
 * shows the policy refusing what it should. Every other context is watched.
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
