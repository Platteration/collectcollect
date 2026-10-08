import { describe, expect, it } from "vitest";
import { APP_NAME, APP_VERSION, LICENSE_URL, SOURCE_URL } from "@/lib/version";
import pkg from "../package.json";

describe("the version the app reports", () => {
  it("is this app's package.json, so the About section and /api/health say what the release says", () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("names the app and links its source and licence over https", () => {
    expect(APP_NAME).toMatch(/^CollectCollect/);
    expect(SOURCE_URL).toMatch(/^https:\/\//);
    expect(LICENSE_URL.startsWith(SOURCE_URL)).toBe(true);
  });
});
