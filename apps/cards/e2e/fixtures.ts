import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * The website's rules, held in every test.
 *
 * Every spec imports `test` from here, so every page any test drives fails it
 * on a content security policy violation (the `securitypolicyviolation` event
 * in the page and the browser's console report), on an uncaught exception, and
 * on a request that leaves this site other than an image the policy allows.
 * The policy was measured this way: a source something real needs cannot be
 * missing without some test going red. A test that makes contexts of its own
 * with `browser.newContext()` is not covered; `website.spec.ts` holds the
 * headers themselves to the README.
 */

/** Which app's block of the README this suite reads. */
export const APP = "cards";

/** Images may come from any https host (a price source's reference image, a grader's scans), as img-src says. */
export function allowedOutside(url: URL, resourceType: string): boolean {
  return resourceType === "image" && url.protocol === "https:";
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
      if (!allowedOutside(url, request.resourceType())) problems.push(`a request left the site: ${request.method()} ${request.resourceType()} ${url.href}`);
    });
  };
  context.pages().forEach(attach);
  context.on("page", attach);
}

export const test = base.extend<{ siteRules: string[] }>({
  siteRules: [
    async ({ context, baseURL }, use) => {
      const problems: string[] = [];
      await watch(context, new URL(baseURL ?? "http://127.0.0.1").origin, problems);
      await use(problems);
      expect(problems, "policy violations, page errors and requests that left the site").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
