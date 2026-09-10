import { describe, expect, it } from "vitest";
import { declaredTooLarge } from "@/lib/http";

const withLength = (value: string | null) =>
  new Request("http://localhost/api/import", {
    method: "POST",
    body: "x",
    headers: value === null ? {} : { "content-length": value },
  });

describe("declaredTooLarge", () => {
  it("refuses a body that says it is over the limit", () => {
    expect(declaredTooLarge(withLength("2000"), 1000)).toBe(true);
  });

  it("lets a body within the limit through", () => {
    expect(declaredTooLarge(withLength("1000"), 1000)).toBe(false);
    expect(declaredTooLarge(withLength("0"), 1000)).toBe(false);
  });

  it("lets a request with no usable Content-Length through to the real check", () => {
    // A chunked upload declares no length; refusing it would break a legitimate client.
    expect(declaredTooLarge(withLength(null), 1000)).toBe(false);
    expect(declaredTooLarge(withLength("not-a-number"), 1000)).toBe(false);
  });
});
