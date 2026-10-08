import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { securityHeaders } from "@collectcollect/core/proxy";
import { MAX_REQUEST_BYTES, MAX_REQUEST_SIZE } from "@collectcollect/core/limits";
import { RESTORE_MAX_BYTES } from "@/lib/backup";
import { IMPORT_MAX_BYTES } from "@/lib/markdown/restore";

describe("what a static file is served with", () => {
  it("carries every security header the proxy puts on a page, except the two only a request can decide", async () => {
    // The proxy's matcher leaves /_next/ alone, so next.config.ts has to say
    // it, and cannot import the proxy to do so: this keeps its literal copy
    // equal to the proxy's, camera allowance included.
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/_next/:path*");
    const expected = securityHeaders("", { camera: true });
    delete expected["Content-Security-Policy"];
    expect(Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]))).toEqual(expected);
  });
});

describe("how much of a request body reaches a route", () => {
  it("buffers as much as the largest body any route accepts, so nothing arrives cut short", () => {
    // With a proxy in front of every route, Next buffers each body up to
    // proxyClientMaxBodySize (10 MB unless set) and silently truncates the
    // rest, so a restore of anything bigger failed as a malformed upload.
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(MAX_REQUEST_SIZE);
    expect(MAX_REQUEST_SIZE).toBe(`${MAX_REQUEST_BYTES / 1024 / 1024}mb`);
    for (const ceiling of [RESTORE_MAX_BYTES, IMPORT_MAX_BYTES]) expect(ceiling).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
  });

  it("does not name the framework on every response", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
