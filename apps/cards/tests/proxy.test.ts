import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createProxy } from "@collectcollect/core/proxy";
import { isAllowedHost, isCrossSiteWrite } from "@collectcollect/core/net";
import type { Auth } from "@collectcollect/core/auth";

/** An auth whose password is on or off, and whose every cookie is good. */
function fakeAuth(enabled: boolean): Auth {
  return {
    authEnabled: () => enabled,
    verifyToken: async () => true,
    SESSION_COOKIE: "test_session",
  } as unknown as Auth;
}

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers: { host: "localhost:3000", ...init.headers } });
}

const proxyFor = (enabled: boolean) => createProxy(fakeAuth(enabled), { publicPaths: ["/login", "/api/health"] });

afterEach(() => {
  delete process.env.ALLOWED_HOSTS;
  delete process.env.TRUST_PROXY;
});

describe("a write sent by another site", () => {
  // Reproduced against `next dev` with no password: a text/plain POST carrying
  // another site's Origin created a card, and needed no preflight to do it.
  const json = JSON.stringify({ name: "Planted", game: "pokemon" });

  it("is refused with no password set", async () => {
    const response = await proxyFor(false)(request("/api/cards", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example", "content-type": "text/plain" },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("is refused with a password set too, and from a sibling port", async () => {
    const response = await proxyFor(true)(request("/api/backup/restore", {
      method: "POST",
      headers: { "sec-fetch-site": "same-site", origin: "http://localhost:3001" },
    }));
    expect(response.status).toBe(403);
  });

  it("is told apart by Origin when the browser sends no Sec-Fetch-Site", () => {
    const post = (origin: string, host = "localhost:3000") =>
      isCrossSiteWrite(new Request("http://localhost:3000/api/cards", { method: "POST", headers: { origin, host } }));
    expect(post("https://evil.example")).toBe(true);
    expect(post("null")).toBe(true);
    expect(post("not a url")).toBe(true);
    expect(post("http://localhost:3000")).toBe(false);
    // Behind a proxy that ends TLS the page's origin implies 443 and Host has no port.
    expect(post("https://cards.example", "cards.example")).toBe(false);
  });

  it("lets the app's own pages, a typed address and non-browser clients through", () => {
    const post = (headers: Record<string, string>) =>
      isCrossSiteWrite(new Request("http://localhost:3000/api/cards", { method: "POST", headers: { host: "localhost:3000", ...headers } }));
    expect(post({ "sec-fetch-site": "same-origin", origin: "http://localhost:3000" })).toBe(false);
    expect(post({ "sec-fetch-site": "none" })).toBe(false);
    expect(post({})).toBe(false); // curl, a script, the container health check
  });

  it("does not touch reads, which cannot change anything", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(isCrossSiteWrite(new Request("http://localhost:3000/api/cards", { method, headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
    }
  });

  it("reads the forwarded host only from a trusted proxy", () => {
    const post = () => isCrossSiteWrite(new Request("http://10.0.0.5:3000/api/cards", {
      method: "POST",
      headers: { origin: "https://cards.example", host: "10.0.0.5:3000", "x-forwarded-host": "cards.example" },
    }));
    expect(post()).toBe(true);
    process.env.TRUST_PROXY = "1";
    expect(post()).toBe(false);
  });
});

describe("a Host no other site can own", () => {
  // Reproduced against `next dev` with no password: GET /api/cards with
  // `Host: attacker.example` answered with the whole collection, which is what
  // a page that has rebound its own name to 127.0.0.1 gets to read.
  it("is required with no password set", async () => {
    const rebound = await proxyFor(false)(request("/api/cards", { headers: { host: "attacker.example:3000" } }));
    expect(rebound.status).toBe(403);
    expect(await rebound.text()).toContain("ALLOWED_HOSTS");
    const local = await proxyFor(false)(request("/api/cards"));
    expect(local.status).toBe(200);
  });

  it("is not asked for once a password is set, since a rebound page has no session", async () => {
    const response = await proxyFor(true)(request("/api/cards", { headers: { host: "cards.example" } }));
    expect(response.status).toBe(200);
  });

  it("means loopback names, addresses, and the names ALLOWED_HOSTS lists", () => {
    for (const host of ["localhost", "localhost:3000", "cards.localhost:3000", "127.0.0.1:3000", "192.168.1.20:3000", "[::1]:3000", "[fe80::1]"]) {
      expect(isAllowedHost(host), host).toBe(true);
    }
    for (const host of [null, "", "attacker.example", "localhost.attacker.example", "127.0.0.1.nip.io", "laptop.lan:3000"]) {
      expect(isAllowedHost(host), String(host)).toBe(false);
    }
    expect(isAllowedHost("laptop.lan:3000", "nas.lan, Laptop.LAN:8080")).toBe(true);
    expect(isAllowedHost("laptop.lan.attacker.example", "laptop.lan")).toBe(false);
  });
});
