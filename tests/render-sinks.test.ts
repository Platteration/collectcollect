import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gameColor } from "@/components/Portfolio";
import { slabClass } from "@/components/Slab";
import { label } from "@/lib/types";

/**
 * Values that land in a `style` attribute or a class list are not text.
 *
 * React escapes a text node; it does not escape a style value, so whatever a
 * table lookup returns for a colour goes into the attribute verbatim — the same
 * thing cards.ts says about accent colours ("only a #rrggbb literal may be
 * stored, since it goes straight into a style attribute"). label() is the wrong
 * helper here precisely because its fallback is the raw key, which is right for
 * a label the owner has to read and wrong for everything else.
 */
describe("a value that becomes a colour or a class", () => {
  it("falls back to a colour, never to the key it was looked up with", () => {
    expect(gameColor("pokemon")).toBe("var(--chart-series-1)");
    for (const key of ["__proto__", "constructor", "toString", "url(http://198.51.100.7/pixel)", "red; background:url(x)"]) {
      const value = gameColor(key);
      expect(value).not.toContain(key);
      // Only this app's own custom properties are ever painted.
      expect(value).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it("falls back to no class at all, never to one built out of the row", () => {
    expect(slabClass("PSA")).toBe("slab-psa");
    for (const key of ["__proto__", "constructor", "toString", "PSA slab-psa\" onmouseover=x"]) {
      expect(slabClass(key)).toBe("");
    }
    expect(slabClass(null)).toBe("");
  });

  it("keeps label() for text, where the raw key is the point", () => {
    // The row the owner has to find and delete must render, not throw.
    expect(label({ a: "A" }, "__proto__")).toBe("__proto__");
    expect(label({ a: "A" }, "a")).toBe("A");
  });

  /**
   * The rule, rather than one more instance of it: a table of colours or class
   * names read through label() is a raw database value in a style attribute or
   * a class list, and grep is the only thing that will notice the next one.
   */
  it("is not read through label() anywhere in the app", () => {
    const root = path.resolve(__dirname, "..", "src");
    const offences: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          for (const [i, line] of fs.readFileSync(full, "utf8").split("\n").entries()) {
            if (/\blabel\(\s*[A-Za-z0-9_.]*(COLOR|COLOUR|STYLE|CLASS)/i.test(line)) {
              offences.push(`${path.relative(root, full)}:${i + 1}: ${line.trim()}`);
            }
          }
        }
      }
    };
    walk(root);
    expect(offences).toEqual([]);
  });
});
