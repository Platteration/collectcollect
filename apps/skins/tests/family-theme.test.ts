import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COLOR_SCHEMES } from "@collectcollect/core/color-schemes";
import { normalizeScheme, normalizeTheme } from "@collectcollect/core/appearance";

const css = readFileSync(new URL("../../../packages/core/src/family-theme.css", import.meta.url), "utf8");

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

describe("shared hobby appearance", () => {
  it("retains existing IDs and normalizes missing or invalid preferences", () => {
    for (const { id } of COLOR_SCHEMES) expect(normalizeScheme(id)).toBe(id);
    for (const invalid of [null, "", "constructor", "unknown"]) expect(normalizeScheme(invalid)).toBe("teal");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme(null)).toBe("system");
    expect(normalizeTheme("invalid")).toBe("system");
  });

  for (const { id, swatch } of COLOR_SCHEMES) for (const mode of ["light", "dark"]) {
    it(`${id}/${mode}: coordinates surfaces without recoloring financial or category data`, () => {
      const selector = `:root[data-theme="${mode}"][data-scheme="${id}"]`;
      const start = css.indexOf(selector);
      expect(start).toBeGreaterThanOrEqual(0);
      const block = css.slice(start + selector.length, css.indexOf("}", start));
      const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((m) => [m[1], m[2]]));
      expect(Object.keys(tokens).sort()).toEqual(["accent", "accent-ink", "accent-solid", "background", "surface", "surface-raised"]);
      expect(block).not.toMatch(/--chart-(?:good|bad|raw|series)/);
      if (mode === "light") expect(tokens.accent).toBe(swatch);
      expect(contrast(tokens.accent, tokens["accent-ink"])).toBeGreaterThanOrEqual(4.5);
      const texts = mode === "light" ? ["#24333e", "#53626c", "#006300", "#b32b2b"] : ["#f7f1e5", "#c2cad1", "#4ff0a1", "#ff8189"];
      for (const surface of ["background", "surface", "surface-raised"]) {
        for (const text of texts) expect(contrast(text, tokens[surface])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens.accent, tokens[surface])).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("keeps financial and collectible identity tokens out of the shared stylesheet", () => {
    expect(css).not.toMatch(/--(?:chart-(?:good|bad|raw|series)[\w-]*|slab-label|rarity[\w-]*)\s*:/);
    expect(css).toContain("--chart-surface: var(--surface)");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media print");
  });
});
