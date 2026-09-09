import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.ALLOWED_HOSTS;
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
});

describe("cross-site writes", () => {
  it("refuses a state-changing request a browser made from another site", async () => {
    const cases: Array<{ site?: string; origin?: string }> = [
      { site: "cross-site" },
      { site: "same-site" },
      { site: "cross-site", origin: "https://evil.example" },
      { origin: "https://evil.example" },
      { origin: "null" },
      // Another port on the same machine is a different origin.
      { origin: "http://localhost:8080" },
    ];
    for (const headers of cases) {
      expect(await status(request("http://localhost:3000/api/backup/restore", { method: "POST", ...headers }))).toBe(403);
    }
    // Every write method, not just POST, and page routes as well as the API.
    expect(await status(request("http://localhost:3000/api/cards/1", { method: "DELETE", site: "cross-site" }))).toBe(403);
    expect(await status(request("http://localhost:3000/settings", { method: "POST", site: "cross-site" }))).toBe(403);
  });

  it("lets the app's own requests and header-free clients through", async () => {
    const ok = [
      { method: "POST", site: "same-origin", origin: "http://localhost:3000" },
      { method: "POST", site: "same-origin" },
      { method: "POST" }, // curl: neither header
      { method: "DELETE", site: "same-origin" },
    ];
    for (const headers of ok) {
      expect(await status(request("http://localhost:3000/api/prices/refresh", headers))).toBe(200);
    }
  });

  it("does not block reads, which the same-origin policy already covers", async () => {
    expect(await status(request("http://localhost:3000/api/cards", { site: "cross-site", origin: "https://evil.example" }))).toBe(200);
  });
});

describe("password gate", () => {
  it("still refuses an API call without a session, and only after the host check", async () => {
    process.env.APP_PASSWORD = "hunter2";
    expect(await status(request("http://localhost:3000/api/cards"))).toBe(401);
    expect(await status(request("http://localhost:3000/api/auth", { method: "POST", site: "same-origin" }))).toBe(200);
    expect(await status(request("http://localhost:3000/collection"))).toBe(307);
    expect(await status(request("http://localhost:3000/api/cards", { host: "rebind.attacker.example" }))).toBe(403);
  });
});
