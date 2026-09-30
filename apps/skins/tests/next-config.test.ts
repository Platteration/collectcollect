import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { securityHeaders } from "@collectcollect/core/proxy";

describe("what a static file is served with", () => {
  it("carries every security header the proxy puts on a page, except the two only a request can decide", async () => {
    // The proxy's matcher leaves /_next/ alone, so next.config.ts has to say
    // it, and cannot import the proxy to do so: this keeps its literal copy
    // equal to the proxy's, and says this app asks for no camera.
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/_next/:path*");
    const expected = securityHeaders("", { camera: false });
    delete expected["Content-Security-Policy"];
    expect(Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]))).toEqual(expected);
  });
});
