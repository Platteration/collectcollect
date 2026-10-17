import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";
import { MAX_REQUEST_BYTES, MAX_REQUEST_SIZE } from "../src/limits";
import { RESTORE_MAX_BYTES } from "../src/domain/backup";
import { IMPORT_MAX_BYTES } from "../src/domain/markdown/restore";

/**
 * What every app on the domain engine, and the template a new one is made
 * from, tells Next, read off their own next.config.ts. Cards and skins hold
 * themselves to the same in their tests/next-config.test.ts.
 *
 * The one that matters most is the body buffer. Each app has a proxy, so Next
 * buffers a copy of every request body, and past proxyClientMaxBodySize (10 MB
 * unless set) it truncates the body instead of refusing the request
 * (src/limits.ts). A backup over 10 MB then reached the restore route cut
 * short and failed as if it were not a backup: the way back from a broken
 * collection did not work for any collection with a few photos in it.
 */
const ROOT = path.join(import.meta.dirname, "../../..");
const APPS = path.join(ROOT, "apps");
const domainApps = fs
  .readdirSync(APPS)
  .filter((app) => fs.existsSync(path.join(APPS, app, "src/lib/engine.ts")))
  .sort();
const configs: Array<[string, string]> = [
  ...domainApps.map((app): [string, string] => [app, path.join(APPS, app, "next.config.ts")]),
  ["the create-domain template", path.join(ROOT, "packages/create-domain/template/next.config.ts")],
];

describe("the domain apps' next.config.ts", () => {
  it("are found: the four apps on the engine and the template", () => {
    expect(domainApps).toEqual(expect.arrayContaining(["comics", "retro-games", "watches", "whisky"]));
  });

  for (const [name, file] of configs) {
    it(`${name}: buffers as much as the largest body any route accepts, names no framework and leaves the trailing slash to the proxy`, async () => {
      const config = (await import(/* @vite-ignore */ file)).default as NextConfig;
      expect(config.experimental?.proxyClientMaxBodySize).toBe(MAX_REQUEST_SIZE);
      expect(config.poweredByHeader).toBe(false);
      expect(config.skipTrailingSlashRedirect).toBe(true);
      expect(config.headers).toBeUndefined();
    });
  }

  it("ask for no body larger than that buffer: a restore and a folder import are refused past it, never cut short", () => {
    expect(MAX_REQUEST_SIZE).toBe(`${MAX_REQUEST_BYTES / 1024 / 1024}mb`);
    for (const ceiling of [RESTORE_MAX_BYTES, IMPORT_MAX_BYTES]) expect(ceiling).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
  });

  for (const app of domainApps) {
    it(`${app}: the proxy makes the trailing-slash redirect Next no longer makes, with the security headers`, async () => {
      const { proxy } = (await import(/* @vite-ignore */ path.join(APPS, app, "src/proxy.ts"))) as { proxy: (request: NextRequest) => Promise<Response> };
      for (const [from, to] of [
        ["/collection/", "/collection"],
        ["/collection/?q=Redline", "/collection?q=Redline"],
        ["/api/items/", "/api/items"],
      ]) {
        const res = await proxy(new NextRequest(`http://localhost:3000${from}`, { headers: { host: "localhost:3000" } }));
        expect(res.status, from).toBe(308);
        expect(res.headers.get("Location"), from).toBe(`http://localhost:3000${to}`);
        expect(res.headers.get("Content-Security-Policy"), from).toContain("default-src 'none'");
      }
    });
  }
});
