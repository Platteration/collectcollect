import { describe, expect, it } from "vitest";
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME } from "@collectcollect/core/color-schemes";

describe("the shared color scheme list", () => {
  it("offers several distinct, uniquely identified schemes including the default", () => {
    expect(COLOR_SCHEMES.length).toBeGreaterThanOrEqual(8);
    const ids = COLOR_SCHEMES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = COLOR_SCHEMES.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const scheme of COLOR_SCHEMES) expect(scheme.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ids).toContain(DEFAULT_COLOR_SCHEME);
  });
});
