import { afterEach, describe, expect, it } from "vitest";
import { isPrivateAddress, isSecureRequest, isWebhookUrl, parseId, tooLarge } from "@collectcollect/core/http";

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
    ]) {
      expect(isWebhookUrl(inward), inward).toBe(false);
    }
    for (const outward of ["http://172.32.0.1/hook", "http://8.8.8.8/hook", "https://[2606:4700::1111]/hook", "https://hooks.example/x"]) {
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

  it("believes the URL, and a forwarded protocol only from a trusted proxy", () => {
    expect(isSecureRequest(new Request("https://cards.example/"))).toBe(true);
    expect(isSecureRequest(new Request("http://cards.example/"))).toBe(false);
    const forwarded = new Request("http://cards.example/", { headers: { "x-forwarded-proto": "https" } });
    // Anyone can send the header; without a proxy to have set it, it means nothing.
    expect(isSecureRequest(forwarded)).toBe(false);
    process.env.TRUST_PROXY = "1";
    expect(isSecureRequest(forwarded)).toBe(true);
    expect(isSecureRequest(new Request("http://cards.example/", { headers: { "x-forwarded-proto": "https, http" } }))).toBe(true);
    expect(isSecureRequest(new Request("http://cards.example/", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
  });
});
