import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { GET as guardRoute } from "@/app/guard.js/route";
import nextConfig from "../next.config";
import { contentSecurityPolicy } from "@collectcollect/core/proxy";
import { guardResponse, guardSource } from "@collectcollect/core/guard";

/**
 * The website layer: the headers every response carries, held word for word
 * to the README's block for this app, and the files a website answers at
 * fixed addresses. The browser suite (e2e/website.spec.ts) holds the live
 * responses of a production build to the same block.
 */
const APP = "cards";
const APP_NAME = "CollectCollect";
const PASSWORD = "APP_PASSWORD";
const REPO = path.join(import.meta.dirname, "../../..");
const PUBLIC = path.join(import.meta.dirname, "../public");

afterEach(() => {
  delete process.env[PASSWORD];
  delete process.env.APP_BASE_URL;
  vi.unstubAllEnvs();
});

/** The README's block for this app: header name (lower case) to value, `{nonce}` where each response's nonce goes. */
function documented(): Map<string, string> {
  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  const block = new RegExp(`<!-- headers:${APP}:begin -->\\s*\`\`\`text\\n([\\s\\S]*?)\`\`\`\\s*<!-- headers:${APP}:end -->`).exec(readme);
  if (!block?.[1]) throw new Error(`README.md has no headers block for ${APP}`);
  return new Map(
    block[1]
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const at = line.indexOf(": ");
        return [line.slice(0, at).toLowerCase(), line.slice(at + 2)];
      }),
  );
}

/** Every header name that is about security; a response may carry none of these the README does not name. */
const SECURITY_HEADERS = [
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "cross-origin-embedder-policy",
  "strict-transport-security",
  "x-powered-by",
];

const NONCE = /'nonce-([A-Za-z0-9+/=]+)'/;

/** A request as a browser sends it. */
function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers: { host: new URL(url).host, ...headers } });
}

/** The security headers the proxy answered with, the nonce written as the README writes it. */
async function served(url: string): Promise<Map<string, string>> {
  const res = await proxy(request(url));
  const out = new Map<string, string>();
  for (const name of SECURITY_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) out.set(name, name === "content-security-policy" ? value.replace(NONCE, "'nonce-{nonce}'") : value);
  }
  return out;
}

/** The README's block as an http answer reads: no HSTS, no upgrade. */
function overHttp(headers: Map<string, string>): Map<string, string> {
  const out = new Map(headers);
  out.delete("strict-transport-security");
  out.set("content-security-policy", out.get("content-security-policy")!.replace("; upgrade-insecure-requests", ""));
  return out;
}

describe("the headers every response carries", () => {
  it("are the README's block, word for word, over https", async () => {
    const block = documented();
    expect([...block.keys()].sort()).toEqual([
      "content-security-policy",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
      "permissions-policy",
      "referrer-policy",
      "strict-transport-security",
      "x-content-type-options",
      "x-frame-options",
    ]);
    expect(await served("https://localhost:3000/")).toEqual(block);
  });

  it("are the same less HSTS and the upgrade over plain http, which on a home network would send every file to a port nothing listens on", async () => {
    const http = await served("http://localhost:3000/collection");
    expect(http).toEqual(overHttp(documented()));
    expect(http.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
  });

  it("promise https behind a proxy the app was not told about when the deployment says it serves https", async () => {
    process.env.APP_BASE_URL = "https://cards.example";
    expect(await served("http://localhost:3000/")).toEqual(documented());
  });

  it("cover the framework's own files, the not-found page and a refusal as well as the pages", async () => {
    for (const url of ["http://localhost:3000/_next/static/chunks/app.js", "http://localhost:3000/favicon.ico", "http://localhost:3000/_next/nope", "http://localhost:3000/api/cards"]) {
      expect(await served(url), url).toEqual(overHttp(documented()));
    }
    const refused = await proxy(request("http://localhost:3000/api/backup", { host: "rebind.attacker.example" }));
    expect(refused.status).toBe(403);
    expect(refused.headers.get("Content-Security-Policy")).toMatch(/^default-src 'none'; /);
    expect(refused.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });

  it("hand the renderer the same policy, with a nonce nobody can predict", async () => {
    const one = await proxy(request("http://localhost:3000/"));
    const two = await proxy(request("http://localhost:3000/"));
    const nonce = NONCE.exec(one.headers.get("Content-Security-Policy") ?? "")?.[1];
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/); // 16 random bytes
    expect(NONCE.exec(two.headers.get("Content-Security-Policy") ?? "")?.[1]).not.toBe(nonce);
    // What Next reads back while it renders: the policy on the request, and the nonce the layout stamps.
    expect(one.headers.get("x-middleware-request-content-security-policy")).toBe(one.headers.get("Content-Security-Policy"));
    expect(one.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("are loosened under next dev by exactly what its overlay and hot reload need, and only there", () => {
    const dev = contentSecurityPolicy("n", [], { dev: true });
    expect(dev).toContain("script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'");
    expect(dev).toContain("style-src 'self' 'unsafe-inline'");
    expect(dev).toContain("connect-src 'self' ws: wss:");
    for (const env of ["production", "test", "staging"]) {
      vi.stubEnv("NODE_ENV", env);
      const built = contentSecurityPolicy("n");
      expect(built, env).not.toMatch(/unsafe-eval|ws:|style-src 'self' 'unsafe-inline'/);
    }
  });

  it("run for every path but the development server's hot-reload socket", () => {
    expect(config.matcher).toEqual(["/((?!_next/webpack-hmr).*)"]);
    const matches = (pathname: string) => new RegExp(`^${config.matcher[0]}$`).test(pathname);
    for (const pathname of ["/", "/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/robots.txt", "/api/cards"]) expect(matches(pathname), pathname).toBe(true);
    expect(matches("/_next/webpack-hmr")).toBe(false);
  });

  it("are not written in next.config too, where a header frozen into the build could only contradict them", () => {
    expect(nextConfig.headers).toBeUndefined();
  });
});

describe("what is served without a session", () => {
  it("is the framework's build files, robots.txt, security.txt and the safety net, which the login page and a crawler need, and nothing beside them", async () => {
    process.env[PASSWORD] = "hunter2";
    for (const pathname of ["/_next/static/chunks/app.js", "/_next/static/media/font.woff2", "/robots.txt", "/.well-known/security.txt", "/guard.js"]) {
      expect((await proxy(request(`http://localhost:3000${pathname}`))).status, pathname).toBe(200);
    }
    for (const pathname of ["/.well-known/other.txt", "/_next/image", "/robots.txt.bak", "/guard.jsx", "/collection"]) {
      expect((await proxy(request(`http://localhost:3000${pathname}`))).status, pathname).toBe(307);
    }
    expect((await proxy(request("http://localhost:3000/api/cards"))).status).toBe(401);
  });
});

describe("what the browser may keep", () => {
  it("is no API answer, refusals included, but a photo keeps the lifetime its route names", async () => {
    expect((await proxy(request("http://localhost:3000/api/cards"))).headers.get("Cache-Control")).toBe("no-store");
    expect((await proxy(request("http://localhost:3000/api/uploads/1b6e7371-34eb-46ac-b146-12de0a6e952d.jpg"))).headers.get("Cache-Control")).toBeNull();
    process.env[PASSWORD] = "hunter2";
    const refused = await proxy(request("http://localhost:3000/api/cards"));
    expect(refused.status).toBe(401);
    expect(refused.headers.get("Cache-Control")).toBe("no-store");
    // Outside /api/ the framework's own answer stands (private, no-store for a page), which a header from here would replace.
    expect((await proxy(request("http://localhost:3000/robots.txt"))).headers.get("Cache-Control")).toBeNull();
  });
});

describe("the files a website answers at fixed addresses", () => {
  it("asks every crawler to stay out of one owner's collection", () => {
    const robots = fs.readFileSync(path.join(PUBLIC, "robots.txt"), "utf8");
    const rules = robots.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
    expect(rules).toEqual(["User-agent: *", "Disallow: /"]);
  });

  it("points reporters where SECURITY.md does, and has not expired", () => {
    const text = fs.readFileSync(path.join(PUBLIC, ".well-known/security.txt"), "utf8");
    const fields = new Map(
      text
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("#"))
        .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]),
    );
    expect([...fields.keys()].sort()).toEqual(["Contact", "Expires", "Policy", "Preferred-Languages"]);
    // SECURITY.md asks for GitHub's private reporting, not a public issue.
    expect(fs.readFileSync(path.join(REPO, "SECURITY.md"), "utf8")).toContain("private vulnerability reporting");
    expect(fields.get("Contact")).toBe("https://github.com/Platteration/collectcollect/security/advisories/new");
    expect(fields.get("Policy")).toBe("https://github.com/Platteration/collectcollect/blob/HEAD/SECURITY.md");
    expect(fields.get("Preferred-Languages")).toBe("en");
    // RFC 9116: an expiry, a year ahead at most. Renew it before it lapses; this fails once it has.
    const expires = Date.parse(fields.get("Expires") ?? "");
    expect(fields.get("Expires")).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/);
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires - Date.now()).toBeLessThanOrEqual(366 * 24 * 3600 * 1000);
  });
});

describe("the safety net", () => {
  it("is served at /guard.js with this app's name in its note, revalidated on every load", async () => {
    const res = guardRoute();
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    const text = await res.text();
    expect(text).toBe(guardSource(APP_NAME));
    expect(text).toContain(`"${APP_NAME} didn't finish loading`);
    expect(text).not.toContain("__APP__");
  });

  it("builds its note from DOM calls, never from an HTML string, and takes no name that could close its string", async () => {
    const text = await guardResponse(APP_NAME).text();
    for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "setAttribute(\"style\""]) expect(text, sink).not.toContain(sink);
    expect(() => guardSource('x"; alert(1); "')).toThrow(/letters, digits and spaces/);
    expect(() => guardSource("x\\")).toThrow();
    expect(() => guardSource("")).toThrow();
  });

  it("does not report a failure to a page that started before it arrived", () => {
    // Started (packages/core/src/components/Started.tsx) leaves this flag; the guard reads it first.
    expect(guardSource(APP_NAME)).toContain("var started = !!window.__collectcollectStarted;");
  });
});
