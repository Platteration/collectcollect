import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The rules every app's browser suite is held to, read off the apps themselves.
 *
 * A suite that drives its pages with Playwright's own `test` passes in silence
 * when a page breaks the content security policy, throws, or asks another host
 * for something: only the `test` in the app's `e2e/fixtures.ts` fails for
 * that. And a suite whose servers can reach the network prices what it adds
 * against the real market, at whatever speed that answers that day. So every
 * app with a `playwright.config.ts` takes its specs' `test` from its fixtures,
 * and each app built on the domain engine starts its servers offline, with the
 * price refresh off, and removes its throwaway data when the run ends. (Cards
 * and skins hold themselves to the first in their own `tests/website.test.ts`;
 * this holds all of them, so an app added later is held to it from its first
 * spec.)
 */
const ROOT = path.join(import.meta.dirname, "../../..");
const APPS = path.join(ROOT, "apps");
const suites = fs
  .readdirSync(APPS)
  .filter((app) => fs.existsSync(path.join(APPS, app, "playwright.config.ts")))
  .sort();
/** The apps whose pages and routes come from the domain engine, which keep their engine in src/lib/engine.ts. */
const domainSuites = suites.filter((app) => fs.existsSync(path.join(APPS, app, "src/lib/engine.ts")));

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
    expect(domainSuites).toEqual(expect.arrayContaining(["retro-games", "comics", "whisky"]));
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

  for (const app of domainSuites) {
    it(`${app}: starts every server offline and with the price refresh off, and removes its data when the run ends`, async () => {
      const dir = path.join(APPS, app);
      const prefix = /envPrefix:\s*"([A-Z_]+)"/.exec(fs.readFileSync(path.join(dir, "src/lib/spec.ts"), "utf8"))?.[1];
      expect(prefix, "the app's envPrefix in src/lib/spec.ts").toBeDefined();
      const config = (await import(/* @vite-ignore */ path.join(dir, "playwright.config.ts"))).default as {
        webServer: Array<{ env?: Record<string, string> }>;
        reporter: unknown;
      };
      const offline = pathToFileURL(path.join(ROOT, "scripts/e2e-offline.mjs")).href;
      expect(config.webServer.length).toBeGreaterThan(0);
      for (const server of config.webServer) {
        expect(server.env?.[`${prefix}_AUTO_REFRESH_HOURS`], "the scheduler's first pass is a minute after start").toBe("0");
        expect(server.env?.NODE_OPTIONS ?? "", "fetch reaches no host but its own").toContain(`--import=${offline}`);
      }
      expect(JSON.stringify(config.reporter), "the reporter that removes the throwaway collections").toContain("./e2e/teardown.ts");
    });
  }
});
