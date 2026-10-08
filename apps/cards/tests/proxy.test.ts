import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.ALLOWED_HOSTS;
  delete process.env.APP_BASE_URL;
  delete process.env.TRUST_PROXY;
});

/** A request as a browser would send it: Host always, the fetch metadata optionally. */
function request(
  url: string,
  opts: { method?: string; host?: string; origin?: string; site?: string } = {},
): NextRequest {
  const headers = new Headers();
  headers.set("host", opts.host ?? new URL(url).host);
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.site) headers.set("sec-fetch-site", opts.site);
  return new NextRequest(url, { method: opts.method ?? "GET", headers });
}

const status = async (req: NextRequest) => (await proxy(req)).status;

describe("host allowlist", () => {
  it("answers on the addresses and machine names a self-hosted app is reached by", async () => {
    expect(await status(request("http://localhost:3000/api/cards"))).toBe(200);
    expect(await status(request("http://127.0.0.1:3000/api/cards"))).toBe(200);
    expect(await status(request("http://[::1]:3000/api/cards"))).toBe(200);
    expect(await status(request("http://192.168.1.20:3000/api/cards"))).toBe(200);
    expect(await status(request("http://cardbox:3000/api/cards"))).toBe(200);
    expect(await status(request("http://cardbox.local:3000/api/cards"))).toBe(200);
    expect(await status(request("http://cards.home.arpa:3000/api/cards"))).toBe(200);
  });

  it("refuses a name the attacker controls, which is how DNS rebinding reads the collection", async () => {
    // The browser sends the attacker's name in Host even after the address flips to this box.
    expect(await status(request("http://localhost:3000/api/backup", { host: "rebind.attacker.example" }))).toBe(403);
    expect(await status(request("http://localhost:3000/", { host: "cards.example.com" }))).toBe(403);
    expect(await status(request("http://localhost:3000/api/cards", { host: "" }))).toBe(403);
    // A trailing dot is the same name, on both sides of the comparison.
    expect(await status(request("http://localhost:3000/", { host: "rebind.attacker.example." }))).toBe(403);
    expect(await status(request("http://localhost:3000/", { host: "localhost.:3000" }))).toBe(200);
  });

  it("takes the names the operator names, and only those", async () => {
    process.env.ALLOWED_HOSTS = "cards.example.com, other.example.com:8443";
    expect(await status(request("http://localhost:3000/", { host: "cards.example.com" }))).toBe(200);
    expect(await status(request("http://localhost:3000/", { host: "other.example.com" }))).toBe(200);
    expect(await status(request("http://localhost:3000/", { host: "localhost:3000" }))).toBe(403);
    process.env.ALLOWED_HOSTS = "*";
    expect(await status(request("http://localhost:3000/", { host: "anything.example" }))).toBe(200);
  });

  it("says why in the shape the caller reads, with the security headers still on", async () => {
    const api = await proxy(request("http://localhost:3000/api/cards", { host: "rebind.attacker.example" }));
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ error: "This server does not answer to that host name. Set ALLOWED_HOSTS to add it." });
    expect(api.headers.get("Content-Security-Policy")).toMatch(/default-src 'self'/);
    expect(api.headers.get("X-Frame-Options")).toBe("DENY");
    const page = await proxy(request("http://localhost:3000/collection", { host: "rebind.attacker.example" }));
    expect(page.status).toBe(403);
    expect(page.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(page.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("cross-site writes", () => {
  it("refuses a state-changing request a browser made from another site", async () => {
    const cases: Array<{ site?: string; origin?: string }> = [
      { site: "cross-site" },
      { site: "same-site" },
      { site: "cross-site", origin: "https://evil.example" },
      { origin: "https://evil.example" },
      { origin: "null" },
      // Another port on the same machine is a different origin: the skins app
      // beside this one must not be able to write here either.
      { origin: "http://localhost:3001" },
    ];
    for (const headers of cases) {
      expect(await status(request("http://localhost:3000/api/backup/restore", { method: "POST", ...headers })), JSON.stringify(headers)).toBe(403);
    }
    // Every write method, not just POST, and page routes as well as the API.
    expect(await status(request("http://localhost:3000/api/cards/1", { method: "DELETE", site: "cross-site" }))).toBe(403);
    expect(await status(request("http://localhost:3000/api/cards/1", { method: "PATCH", origin: "https://evil.example" }))).toBe(403);
    expect(await status(request("http://localhost:3000/settings", { method: "POST", site: "cross-site" }))).toBe(403);
    const refused = await proxy(request("http://localhost:3000/api/goals", { method: "POST", site: "cross-site" }));
    expect(await refused.json()).toEqual({ error: "Cross-site request refused." });
  });

  it("lets the app's own requests and header-free clients through", async () => {
    const ok = [
      { method: "POST", site: "same-origin", origin: "http://localhost:3000" },
      { method: "POST", site: "same-origin" },
      { method: "POST" }, // curl: neither header
      { method: "POST", origin: "http://localhost:3000" },
      { method: "DELETE", site: "same-origin" },
    ];
    for (const headers of ok) {
      expect(await status(request("http://localhost:3000/api/prices/refresh", headers)), JSON.stringify(headers)).toBe(200);
    }
  });

  it("does not block reads, which the same-origin policy already covers", async () => {
    expect(await status(request("http://localhost:3000/api/cards", { site: "cross-site", origin: "https://evil.example" }))).toBe(200);
  });
});

describe("health check", () => {
  it("answers the container's own check without a session and whatever ALLOWED_HOSTS names", async () => {
    process.env.APP_PASSWORD = "hunter2";
    expect(await status(request("http://127.0.0.1:3000/api/health"))).toBe(200);
    // Docker reaches the app by address from inside the container; an
    // instance that lists only its domain must not fail its own check.
    process.env.ALLOWED_HOSTS = "cards.example.com";
    expect(await status(request("http://127.0.0.1:3000/api/health"))).toBe(200);
    // That exemption is for the one path: the collection stays behind the list.
    expect(await status(request("http://127.0.0.1:3000/api/cards"))).toBe(403);
  });
});

describe("password gate", () => {
  it("still refuses an API call without a session, and only after the host check", async () => {
    process.env.APP_PASSWORD = "hunter2";
    expect(await status(request("http://localhost:3000/api/cards"))).toBe(401);
    expect(await status(request("http://localhost:3000/api/auth", { method: "POST", site: "same-origin" }))).toBe(200);
    expect(await status(request("http://localhost:3000/collection"))).toBe(307);
    expect(await status(request("http://localhost:3000/api/cards", { host: "rebind.attacker.example" }))).toBe(403);
    // The login form's own POST is a same-origin write; a cross-site one is not a login.
    expect(await status(request("http://localhost:3000/api/auth", { method: "POST", origin: "https://evil.example" }))).toBe(403);
  });
});

describe("security headers", () => {
  /** The policy as directive -> sources. */
  const directives = (csp: string | null) =>
    Object.fromEntries((csp ?? "").split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }));

  it("stops the app being framed, sniffed or referred, and keeps the camera for the scan screens alone", async () => {
    const res = await proxy(request("http://localhost:3000/settings"));
    const csp = directives(res.headers.get("Content-Security-Policy"));
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // A page's address names a card, and so do the price-source links.
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=(self)");
    expect(res.headers.get("Permissions-Policy")).toContain("microphone=()");
  });

  it("lets no script in but this origin's and the one inline script it hands a nonce", async () => {
    const csp = directives((await proxy(request("http://localhost:3000/"))).headers.get("Content-Security-Policy"));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    expect(csp["script-src"]?.some((source: string) => source.startsWith("'nonce-"))).toBe(true);
    expect(csp["object-src"]).toEqual(["'none'"]);
    // Nothing sets a <base>; one injected would re-point every relative URL.
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
  });

  it("promises https only where the request or the deployment says it is served over https", async () => {
    const hsts = async (url: string) => (await proxy(request(url))).headers.get("Strict-Transport-Security");
    expect(await hsts("http://localhost:3000/")).toBeNull();
    expect(await hsts("https://localhost:3000/")).toBe("max-age=31536000; includeSubDomains");
    // Behind a proxy the app was not told about, the deployment says it.
    process.env.APP_BASE_URL = "https://cards.example";
    expect(await hsts("http://localhost:3000/")).toBe("max-age=31536000; includeSubDomains");
    process.env.APP_BASE_URL = "http://localhost:3000";
    expect(await hsts("http://localhost:3000/")).toBeNull();
  });
});
