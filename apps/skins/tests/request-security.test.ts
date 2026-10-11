import { afterEach, describe, expect, it } from "vitest";
import { hostAllowed, requestSecurityError } from "@collectcollect/core/request-guard";

afterEach(() => {
  delete process.env.ALLOWED_HOSTS;
  delete process.env.TRUST_PROXY;
});

describe("the passwordless browser boundary", () => {
  it("refuses an attacker Host on reads as well as writes", () => {
    expect(requestSecurityError(new Request("http://rebind.example/api/cards"))?.status).toBe(403);
    expect(requestSecurityError(new Request("http://localhost/api/cards", { headers: { Host: "rebind.example" } }))?.status).toBe(403);
  });

  it("keeps localhost, IPv6, LAN and explicitly configured public hosts reachable", () => {
    process.env.ALLOWED_HOSTS = "cards.example, skins.example";
    for (const host of ["localhost:3000", "[::1]:3000", "192.168.1.2:3000", "cards.local", "cards.example:443", "skins.example"]) {
      expect(hostAllowed(host)).toBe(true);
    }
    expect(hostAllowed("rebind.example")).toBe(false);
    for (const malformed of ["user@cards.example", "cards.example/path", "cards.example:invalid", ""]) expect(hostAllowed(malformed)).toBe(false);
  });

  it("refuses a browser text/plain form whose bytes are valid JSON", () => {
    const body = '{"game":"pokemon","name":"Injected card","notes":"="}\r\n';
    expect(JSON.parse(body).name).toBe("Injected card");
    expect(requestSecurityError(new Request("http://localhost/api/cards", {
      method: "POST", body, headers: { Origin: "https://attacker.example", "Content-Type": "text/plain" },
    }))?.status).toBe(403);
    expect(requestSecurityError(new Request("http://localhost/api/cards", {
      method: "POST", body, headers: { "Content-Type": "text/plain" },
    }))?.status).toBe(415);
  });

  it("checks Fetch Metadata and the full origin, including scheme and port", () => {
    for (const headers of [
      { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" },
      { Origin: "null" }, { Origin: "https://localhost:3000" }, { Origin: "http://localhost:3001" },
    ] as Array<Record<string, string>>) {
      expect(requestSecurityError(new Request("http://localhost:3000/api/cards", { method: "DELETE", headers }))?.status).toBe(403);
    }
    expect(requestSecurityError(new Request("http://localhost:3000/api/cards", {
      method: "POST", headers: { Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" }, body: "{}",
    }))).toBeNull();
  });

  it("lets a bodyless write through without a Content-Type, in the shape the proxy receives", () => {
    // Next hands the proxy a body stream for every method but GET and HEAD, empty or not,
    // so this is a DELETE or an action POST as a script sends it: a stream, no Content-Type,
    // and no header that would give the request a body.
    const asProxied = (method: string, headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/cards/7/price", {
      method, headers, body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: "half",
    } as RequestInit);
    expect(requestSecurityError(asProxied("DELETE"))).toBeNull();
    expect(requestSecurityError(asProxied("POST", { "Content-Length": "0" }))).toBeNull();
    // Bytes, a declared type, or a length that is not plainly zero still have to be JSON.
    expect(requestSecurityError(asProxied("POST", { "Content-Length": "2" }))?.status).toBe(415);
    expect(requestSecurityError(asProxied("POST", { "Transfer-Encoding": "chunked" }))?.status).toBe(415);
    expect(requestSecurityError(asProxied("POST", { "Content-Length": "0", "Content-Type": "application/x-www-form-urlencoded" }))?.status).toBe(415);
    expect(requestSecurityError(asProxied("POST", { "Content-Length": "abc" }))?.status).toBe(415);
  });

  it("supports trusted TLS reverse proxies and scripts without browser provenance headers", () => {
    process.env.ALLOWED_HOSTS = "cards.example";
    process.env.TRUST_PROXY = "1";
    expect(requestSecurityError(new Request("http://cards.example/api/cards", {
      method: "POST", headers: { Origin: "https://cards.example", "X-Forwarded-Proto": "https", "Content-Type": "application/json" }, body: "{}",
    }))).toBeNull();
    expect(requestSecurityError(new Request("http://localhost/api/cards", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }))).toBeNull();
    expect(requestSecurityError(new Request("http://localhost/api/backup/restore", {
      method: "POST", headers: { Origin: "http://localhost", "Content-Type": "multipart/form-data; boundary=example" }, body: "--example--",
    }))).toBeNull();
  });
});
