import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rules every app's browser suite is held to, read off the apps themselves.
 *
 * A suite that drives its pages with Playwright's own `test` passes in silence
 * when a page breaks the content security policy, throws, or asks another host
 * for something: only the `test` in the app's `e2e/fixtures.ts` fails for
 * that. So every app with a `playwright.config.ts` takes its specs' `test` from
 * its fixtures.
 * (Cards and skins hold themselves to that in their own
 * `tests/website.test.ts`; this holds all of them, so an app added later is held
 * to it from its first spec.)
 */
const APPS = path.join(import.meta.dirname, "../../../apps");
const suites = fs
  .readdirSync(APPS)
  .filter((app) => fs.existsSync(path.join(APPS, app, "playwright.config.ts")))
  .sort();

/** Where a suite file takes its `test` from, if it imports one. */
function testSource(e2e: string, file: string): string | undefined {
  const text = fs.readFileSync(path.join(e2e, file), "utf8");
  for (const [, names = "", from] of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    if (names.split(",").some((name) => /^\s*test(\s+as\s+\w+)?\s*$/.test(name))) return from;
  }
  return undefined;
}

/** Whether a file's `test` is fixtures.ts's, directly or through a fixture of its own built on it. */
function heldToTheRules(e2e: string, file: string, seen = new Set<string>()): boolean {
  const from = testSource(e2e, file);
  if (from === "./fixtures") return true;
  if (!from?.startsWith("./") || seen.has(from)) return false;
  seen.add(from);
  return heldToTheRules(e2e, `${from.slice(2)}.ts`, seen);
}

describe("the browser suites", () => {
  it("are found: the apps with a Playwright config include cards, skins and the domain apps with a suite", () => {
    expect(suites).toEqual(expect.arrayContaining(["cards", "skins", "retro-games", "comics", "whisky"]));
  });

  for (const app of suites) {
    const e2e = path.join(APPS, app, "e2e");

    it(`${app}: takes every spec's test from e2e/fixtures.ts, so a page that breaks the policy, throws or reaches another host fails it`, () => {
      expect(fs.existsSync(path.join(e2e, "fixtures.ts")), "e2e/fixtures.ts").toBe(true);
      const specs = fs.readdirSync(e2e).filter((file) => file.endsWith(".spec.ts"));
      expect(specs.length).toBeGreaterThan(0);
      for (const spec of specs) expect(heldToTheRules(e2e, spec), spec).toBe(true);
    });
  }
});
