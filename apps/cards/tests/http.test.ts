import { describe, expect, it } from "vitest";
import { isWebhookUrl, parseId, tooLarge } from "@collectcollect/core/http";

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
    expect(isWebhookUrl("http://localhost:9000/hook")).toBe(true);
    for (const bad of ["ftp://x", "javascript:alert(1)", "hooks.example/x", "", "file:///etc/passwd"]) {
      expect(isWebhookUrl(bad), bad).toBe(false);
    }
  });
});
