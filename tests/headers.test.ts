import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import nextConfig from "../next.config";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";
import { config as proxyConfig, proxy } from "@/proxy";

/** The policy as a lookup of directive -> sources, so assertions read like the header does. */
function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

const headerMap = (env: Record<string, string | undefined>) =>
  Object.fromEntries(securityHeaders(env).map((h) => [h.key, h.value]));

/** A request as a browser would send it, the way tests/proxy.test.ts builds one. */
function request(url: string, opts: { method?: string; host?: string; site?: string } = {}): NextRequest {
  const headers = new Headers();
  headers.set("host", opts.host ?? new URL(url).host);
  if (opts.site) headers.set("sec-fetch-site", opts.site);
  return new NextRequest(url, { method: opts.method ?? "GET", headers });
}

/** What the proxy puts on a response right now, given the process environment. */
const served = async (req: NextRequest) => proxy(req);

afterEach(() => {
  delete process.env.APP_BASE_URL;
  delete process.env.APP_PASSWORD;
  delete process.env.ALLOWED_HOSTS;
});

describe("security headers", () => {
  it("stops the app being framed: the settings page has one-click restore and sign-out", () => {
    const production = headerMap({ NODE_ENV: "production" });
    expect(directives(production["Content-Security-Policy"])["frame-ancestors"]).toEqual(["'none'"]);
    // The older header too, for anything that does not implement frame-ancestors.
    expect(production["X-Frame-Options"]).toBe("DENY");
  });

  it("sends the rest of the baseline", () => {
    const production = headerMap({ NODE_ENV: "production" });
    expect(production["X-Content-Type-Options"]).toBe("nosniff");
    // Price-source links carry card names; no referrer is sent anywhere.
    expect(production["Referrer-Policy"]).toBe("no-referrer");
    expect(production["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("keeps the camera for the scan screens and gives up what nothing uses", () => {
    const policy = headerMap({ NODE_ENV: "production" })["Permissions-Policy"];
    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
  });

  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("allows card art, capture previews and third-party images but keeps everything else on this origin", () => {
    const csp = directives(contentSecurityPolicy({ NODE_ENV: "production" }));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["img-src"]).toEqual(["'self'", "https:", "data:", "blob:"]); // card art, and a photo not yet uploaded
    expect(csp["media-src"]).toEqual(["'self'", "blob:", "mediastream:"]); // the camera preview
    expect(csp["font-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
  });

  it("keeps eval and the dev socket out of a built server", () => {
    const production = contentSecurityPolicy({ NODE_ENV: "production" });
    expect(production).not.toContain("unsafe-eval");
    expect(production).not.toContain("ws:");
    // `next dev` compiles React refresh in the browser and hot-reloads over a
    // socket, so a policy that broke development would simply be turned off again.
    const development = contentSecurityPolicy({ NODE_ENV: "development" });
    expect(directives(development)["script-src"]).toContain("'unsafe-eval'");
    expect(directives(development)["connect-src"]).toContain("ws:");
  });

  it("loosens only for `next dev`, not for anything that merely isn't production", () => {
    // The policy is decided per request now, so the running server's NODE_ENV
    // decides it. A built server started with NODE_ENV=staging, or with it
    // unset, is serving real users.
    for (const env of [{ NODE_ENV: "staging" }, {}, { NODE_ENV: "test" }]) {
      const csp = contentSecurityPolicy(env);
      expect(csp).not.toContain("unsafe-eval");
      expect(csp).not.toContain("ws:");
    }
  });

  it("promises https only where the deployment says it serves https", () => {
    expect(headerMap({ NODE_ENV: "production", APP_BASE_URL: "https://cards.example" })["Strict-Transport-Security"]).toMatch(
      /max-age=31536000/,
    );
    expect(headerMap({ NODE_ENV: "production", APP_BASE_URL: "http://localhost:3000" })["Strict-Transport-Security"]).toBeUndefined();
    expect(headerMap({ NODE_ENV: "production" })["Strict-Transport-Security"]).toBeUndefined();
  });
});

/**
 * Where the headers come from, which is the half a pure function cannot check.
 *
 * `headers()` in next.config is evaluated once by `next build` and frozen into
 * `.next/routes-manifest.json`; the production server answers from the
 * manifest and never calls the config again. HSTS is decided from
 * `APP_BASE_URL`, so a deployment that builds in CI or an image and sets that
 * variable at `npm start` — what .env.example and the README describe — would
 * have been given the build machine's answer instead of its own.
 */
describe("where the headers are decided", () => {
  /** Every branch the proxy can answer from, each of which a browser acts on. */
  const branches: Array<{ name: string; env?: Record<string, string>; req: () => NextRequest; status: number }> = [
    { name: "pass-through", req: () => request("http://localhost:3000/collection"), status: 200 },
    { name: "public path", env: { APP_PASSWORD: "hunter2" }, req: () => request("http://localhost:3000/login"), status: 200 },
    { name: "API without a session", env: { APP_PASSWORD: "hunter2" }, req: () => request("http://localhost:3000/api/cards"), status: 401 },
    { name: "login redirect", env: { APP_PASSWORD: "hunter2" }, req: () => request("http://localhost:3000/collection"), status: 307 },
    { name: "host refused", req: () => request("http://localhost:3000/", { host: "rebind.attacker.example" }), status: 403 },
    {
      name: "cross-site write refused",
      req: () => request("http://localhost:3000/api/backup/restore", { method: "POST", site: "cross-site" }),
      status: 403,
    },
  ];

  it.each(branches)("carries the whole baseline on the $name branch", async ({ env, req, status }) => {
    Object.assign(process.env, env);
    const res = await served(req());
    expect(res.status).toBe(status);
    const headers = res.headers;
    expect(headers.get("content-security-policy")).toBe(contentSecurityPolicy(process.env));
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(headers.get("permissions-policy")).toContain("camera=(self)");
    expect(headers.get("x-powered-by")).toBeNull();
  });

  it("reads APP_BASE_URL per request, so HSTS follows the running server and not the build", async () => {
    // Nothing is rebuilt or re-imported between these: the same loaded module
    // answers differently because the process environment changed, which is
    // what a build-time `headers()` entry cannot do.
    process.env.APP_BASE_URL = "https://cards.example";
    expect((await served(request("http://localhost:3000/"))).headers.get("strict-transport-security")).toMatch(/max-age=31536000/);

    process.env.APP_BASE_URL = "http://localhost:3000";
    expect((await served(request("http://localhost:3000/"))).headers.get("strict-transport-security")).toBeNull();

    delete process.env.APP_BASE_URL;
    expect((await served(request("http://localhost:3000/"))).headers.get("strict-transport-security")).toBeNull();
  });

  it("keeps the headers out of next.config, where a build would freeze them and a second copy would be sent", () => {
    expect(nextConfig.headers).toBeUndefined();
  });

  it("keeps the matcher that leaves Next's own assets alone", () => {
    // `_next/static` and `_next/image` are scripts, styles and images, not
    // documents: a policy on them governs nothing, and the auth redirect on
    // them would break the login page's own stylesheet. Every route and every
    // page is inside the matcher, so a path that a browser navigates to or a
    // route that answers JSON always carries the headers.
    expect(proxyConfig.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
  });
});
