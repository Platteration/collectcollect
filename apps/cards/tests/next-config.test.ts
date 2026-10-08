import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { MAX_REQUEST_BYTES, MAX_REQUEST_SIZE } from "@collectcollect/core/limits";
import { RESTORE_MAX_BYTES } from "@/lib/backup";
import { IMPORT_MAX_BYTES } from "@/lib/markdown/restore";

describe("what a static file is served with", () => {
  it("is the proxy's whole set, nonce and all, since the proxy now runs for /_next/ too: nothing here can contradict it", () => {
    // This file used to carry a literal copy of five of the proxy's headers
    // for /_next/, less the policy and HSTS. The proxy covers those paths
    // now (tests/website.test.ts holds a chunk's answer to the README's
    // whole block), so a copy here could only disagree with it.
    expect(nextConfig.headers).toBeUndefined();
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
