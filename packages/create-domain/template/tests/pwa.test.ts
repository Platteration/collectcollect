import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { guardName } from "@collectcollect/core/domain/pwa";
import manifest from "@/app/manifest";
import { GET as guard } from "@/app/guard.js/route";
import { spec } from "@/lib/spec";
import { config, proxy } from "@/proxy";

/**
 * What makes the app installable on a phone and gives it the safety net, as
 * this app wires it: its manifest and guard routes, and the proxy that lets a
 * signed-out phone fetch them. The pieces themselves are tested once in
 * packages/core; this holds the wiring. The file is the same in every app and
 * in the template it is copied from, so it reads the app's names from its spec;
 * what needs the app's own files (icons, the worker) is in installable.test.ts.
 */
const password = `${spec.envPrefix}_APP_PASSWORD`;

afterEach(() => {
  delete process.env[password];
});

function request(pathname: string): NextRequest {
  return new NextRequest(`http://localhost:3000${pathname}`, { headers: { host: "localhost:3000" } });
}
/** What `NextResponse.next()` marks: the request went on to the app. */
const wentOn = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("the app's own manifest and guard", () => {
  it("names the app and its dark ground in the web manifest", () => {
    expect(manifest()).toMatchObject({
      name: `CollectCollect ${spec.name}`,
      short_name: spec.name,
      description: spec.description,
      display: "standalone",
      start_url: "/",
      theme_color: spec.theme.dark,
      background_color: spec.theme.dark,
    });
  });

  it("says in its safety net's note which app did not finish loading", async () => {
    expect(await guard().text()).toContain(`${guardName(spec)} didn't finish loading`);
  });
});

describe("the proxy of an installable app", () => {
  it("runs for every path but the development server's hot-reload socket, so each answer carries the security headers", () => {
    expect(config.matcher).toEqual(["/((?!_next/webpack-hmr).*)"]);
    const runs = (pathname: string) => new RegExp(`^${config.matcher[0]}$`).test(pathname);
    for (const pathname of ["/", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/guard.js", "/icons/icon-192.png", "/_next/static/chunks/app.js", "/_next/image", "/no-such-file"]) {
      expect(runs(pathname), pathname).toBe(true);
    }
    expect(runs("/_next/webpack-hmr")).toBe(false);
  });

  it("lets a phone that has not signed in fetch what installing and opening offline need, and nothing of the collection", async () => {
    process.env[password] = "hunter2";
    for (const pathname of ["/login", "/offline", "/manifest.webmanifest", "/sw.js", "/guard.js", "/favicon.ico", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png", "/_next/static/chunks/app.js"]) {
      const response = await proxy(request(pathname));
      expect(wentOn(response), pathname).toBe(true);
      expect(response.headers.get("Content-Security-Policy"), pathname).toContain("default-src 'none'");
    }
    const page = await proxy(request("/collection"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fcollection");
    expect((await proxy(request("/api/items"))).status).toBe(401);
    expect((await proxy(request("/items/1"))).status).toBe(307);
  });
});
