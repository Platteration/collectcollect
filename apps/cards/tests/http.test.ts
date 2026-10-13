import { afterEach, describe, expect, it } from "vitest";
import { isPrivateAddress, isSecureRequest, isWebhookUrl, parseId, tooLarge } from "@collectcollect/core/http";
import { cookieSecure, servedOverHttps } from "@collectcollect/core/net";

describe("reading an id out of a route", () => {
  it("takes the digits of a positive integer and nothing else", () => {
    const cases: Array<[string, number | null]> = [
      ["1", 1],
      ["42", 42],
      ["1234567890", 1234567890],
      ["0", null],
      ["-1", null],
      ["01", null],
      ["1.0", null],
      ["1.5", null],
      ["1e3", null],
      ["0x10", null],
      [" 1", null],
      ["1 ", null],
      ["", null],
      ["abc", null],
      ["12345678901", null],
      ["Infinity", null],
    ];
    for (const [raw, expected] of cases) expect(parseId(raw), JSON.stringify(raw)).toBe(expected);
  });
});

describe("refusing a body by its size before reading it", () => {
  /** A body that fails the test if anything tries to read it. */
  const unreadable = () =>
    new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("the body was read");
      },
    });

  it("answers 413 from the declared length alone", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: unreadable(),
      headers: { "content-length": "2000" },
      // @ts-expect-error -- Node needs this to accept a stream body; the DOM types do not know it.
      duplex: "half",
    });
    const res = tooLarge(request, 1000, "too big");
    expect(res?.status).toBe(413);
    expect(((await res!.json()) as { error: string }).error).toBe("too big");
  });

  it("lets a body through when the length is within reach or unknown", () => {
    const small = new Request("http://localhost/x", { method: "POST", body: "abc" });
    expect(tooLarge(small, 1000, "too big")).toBeNull();
    const unknown = new Request("http://localhost/x", { method: "POST", body: "abc", headers: { "content-length": "" } });
    expect(tooLarge(unknown, 1, "too big")).toBeNull();
  });
});

describe("what counts as a webhook", () => {
  it("is an http or https URL and nothing else", () => {
    expect(isWebhookUrl("https://hooks.example/x")).toBe(true);
    expect(isWebhookUrl("http://93.184.216.34:9000/hook")).toBe(true);
    for (const bad of ["ftp://x", "javascript:alert(1)", "hooks.example/x", "", "file:///etc/passwd"]) {
      expect(isWebhookUrl(bad), bad).toBe(false);
    }
  });

  it("may not point at this machine or its network", () => {
    // The server posts to it with its own standing, so an address that turns
    // inward would reach whatever the server can.
    for (const inward of [
      "http://localhost:9000/hook",
      "http://app.localhost/hook",
      "http://printer.local/hook",
      "http://127.0.0.1/hook",
      "http://127.8.8.8/hook",
      "http://10.1.2.3/hook",
      "http://172.16.0.1/hook",
      "http://172.31.255.255/hook",
      "http://192.168.1.1/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1/hook",
      "http://0.0.0.0/hook",
      "http://[::1]/hook",
      "http://[::]/hook",
      "http://[fd12::1]/hook",
      "http://[fe80::1]/hook",
      "http://[::ffff:10.0.0.1]/hook",
      "http://[::ffff:a00:1]/hook",
      // Not the public internet either: benchmarking, and the IETF protocol assignments.
      "http://198.18.0.1/hook",
      "http://198.19.255.254/hook",
      "http://192.0.0.8/hook",
      // A host written as one integer is an address all the same.
      "http://2130706433/hook",
    ]) {
      expect(isWebhookUrl(inward), inward).toBe(false);
    }
    for (const outward of ["http://172.32.0.1/hook", "http://198.20.0.1/hook", "http://192.0.1.1/hook", "http://8.8.8.8/hook", "https://[2606:4700::1111]/hook", "https://hooks.example/x"]) {
      expect(isWebhookUrl(outward), outward).toBe(true);
    }
    expect(isPrivateAddress("11.0.0.1")).toBe(false);
    expect(isPrivateAddress("not an address")).toBe(false);
  });
});

describe("whether a request came over TLS", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it("believes a forwarded protocol only from a trusted proxy, and never the URL's scheme", () => {
    expect(isSecureRequest(new Request("http://cards.example/"))).toBe(false);
    // Neither app listens for TLS, and the running server writes https into the
    // URL whenever X-Forwarded-Proto merely contains "https", from any client
    // and whatever TRUST_PROXY says: the request the proxy and the routes are
    // handed then looks like this one, which is not evidence of anything.
    for (const header of ["https", "https, http", "x-https"]) {
      expect(isSecureRequest(new Request("https://cards.example/", { headers: { "x-forwarded-proto": header } })), header).toBe(false);
    }
    expect(isSecureRequest(new Request("https://cards.example/"))).toBe(false);
    const forwarded = new Request("http://cards.example/", { headers: { "x-forwarded-proto": "https" } });
    // Anyone can send the header; without a proxy to have set it, it means nothing.
    expect(isSecureRequest(forwarded)).toBe(false);
    process.env.TRUST_PROXY = "1";
    expect(isSecureRequest(forwarded)).toBe(true);
    // With a proxy declared, it is still the entry the proxy wrote that decides, not the URL.
    expect(isSecureRequest(new Request("https://cards.example/", { headers: { "x-forwarded-proto": "https, http" } }))).toBe(false);
    // The hop the nearest proxy wrote is the rightmost; the client can prepend anything.
    expect(isSecureRequest(new Request("http://cards.example/", { headers: { "x-forwarded-proto": "http, https" } }))).toBe(true);
    expect(isSecureRequest(new Request("http://cards.example/", { headers: { "x-forwarded-proto": "https, http" } }))).toBe(false);
    expect(isSecureRequest(new Request("http://cards.example/", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
  });

  it("follows TRUSTED_PROXY_HOPS, which is the only thing some deployments set", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    try {
      // Two proxies: the outer one saw https and the inner one plain http.
      expect(isSecureRequest(new Request("http://cards.example/", { headers: { "x-forwarded-proto": "https, http" } }))).toBe(true);
      // A chain shorter than the declared proxies was not written by them.
      expect(isSecureRequest(new Request("http://cards.example/", { headers: { "x-forwarded-proto": "https" } }))).toBe(false);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });

  it("serves https to the address APP_BASE_URL names, and plain http to every other name the instance answers to", () => {
    const at = (host: string, headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3000/", { headers: { host, ...headers } });
    const env = { APP_BASE_URL: "https://cards.example" };
    for (const host of ["cards.example", "CARDS.example.", "cards.example:443"]) expect(servedOverHttps(at(host), env), host).toBe(true);
    // The LAN address and names the README tells an owner to keep listing beside
    // the domain are reached over plain http, since neither app serves TLS; and
    // the domain on another port is another address.
    for (const host of ["192.168.1.20:3000", "192.168.1.20", "cardbox.local:3000", "cardbox.lan", "localhost:3000", "cards.example:3000", "cards.example:80", "cards.example.evil", "evil.cards.example", "", "cards.example/x"]) {
      expect(servedOverHttps(at(host), env), host).toBe(false);
    }
    // The address names its port when the proxy listens on another.
    expect(servedOverHttps(at("cards.example:8443"), { APP_BASE_URL: "https://cards.example:8443/" })).toBe(true);
    expect(servedOverHttps(at("cards.example"), { APP_BASE_URL: "https://cards.example:8443/" })).toBe(false);
    // An address that is not https, or not an address, says nothing.
    for (const base of ["http://cards.example", "", "https://", "cards.example", " https://cards.example "]) {
      expect(servedOverHttps(at("cards.example"), { APP_BASE_URL: base }), base).toBe(base === " https://cards.example ");
    }
    // A trusted proxy's word holds for any name it forwards.
    expect(servedOverHttps(at("192.168.1.20:3000", { "x-forwarded-proto": "https" }), {})).toBe(false);
    process.env.TRUST_PROXY = "1";
    expect(servedOverHttps(at("192.168.1.20:3000", { "x-forwarded-proto": "https" }), {})).toBe(true);
  });

  it("marks the cookie Secure as a trusted proxy says, unless COOKIE_SECURE settles it", () => {
    const plain = new Request("http://cards.example/");
    const tls = new Request("https://cards.example/", { headers: { "x-forwarded-proto": "https" } });
    expect(cookieSecure(plain)).toBe(false);
    // The header alone, which the server also turns into an https URL, is anyone's to send.
    expect(cookieSecure(tls)).toBe(false);
    try {
      process.env.TRUST_PROXY = "1";
      expect(cookieSecure(tls)).toBe(true);
      process.env.COOKIE_SECURE = "1";
      expect(cookieSecure(plain)).toBe(true);
      process.env.COOKIE_SECURE = "false";
      expect(cookieSecure(tls)).toBe(false);
    } finally {
      delete process.env.COOKIE_SECURE;
    }
  });
});
