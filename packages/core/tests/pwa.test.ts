import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NoScriptNote } from "../src/components/NoScriptNote";
import { ServiceWorker } from "../src/components/ServiceWorker";
import { Started } from "../src/components/Started";
import { DOMAIN_PUBLIC_PATHS } from "../src/domain/auth";
import { domainGuardResponse, domainManifest, domainServiceWorkerResponse, guardName } from "../src/domain/pwa";
import { appTitle } from "../src/domain/spec";
import { guardSource } from "../src/guard";

// The nonce the proxy mints for a request, as the layout reads it back.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-nonce": "n0nce+/=" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { AppShell, appMetadata, navFor } = await import("../src/pages/AppShell");

const spec = {
  id: "testdomain",
  name: "Test",
  description: "A collection",
  theme: { light: "#ffffff", dark: "#0a0b0c" },
  noun: { singular: "item", plural: "items" },
};

const engine = {
  spec,
  alerts: { unreadCount: () => 0 },
  auth: { authEnabled: () => false },
} as unknown as Parameters<typeof AppShell>[0]["engine"];

/** Every element type in a rendered tree, children and all, so a client component the static markup draws as nothing can still be found. */
function typesIn(node: ReactNode, found = new Set<unknown>()): Set<unknown> {
  if (Array.isArray(node)) for (const child of node) typesIn(child, found);
  else if (isValidElement(node)) {
    found.add(node.type);
    typesIn((node as ReactElement<{ children?: ReactNode }>).props.children, found);
  }
  return found;
}

/** Whether a signed-out visitor can fetch an address, as the proxy decides it: a public path, or something beneath one. */
const publicToAnyone = (url: string) => DOMAIN_PUBLIC_PATHS.some((p) => url === p || url.startsWith(`${p}/`));

describe("the web manifest of a domain app", () => {
  const manifest = domainManifest(spec);

  it("is built from the spec's name, description and dark ground, the way cards and skins build theirs", () => {
    expect(manifest).toMatchObject({
      name: "CollectCollect Test",
      short_name: "Test",
      description: "A collection",
      start_url: "/",
      scope: "/",
      display: "standalone",
      // The splash screen and the browser's chrome match the dark ground the maskable icon sits on.
      background_color: "#0a0b0c",
      theme_color: "#0a0b0c",
    });
    expect(appTitle(spec)).toBe(manifest.name);
  });

  it("lists the 192 and 512 icons and a maskable one, which an installed app on a phone needs", () => {
    const icons = manifest.icons ?? [];
    expect(icons.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ["/icons/icon-192.png", "192x192", "any"],
      ["/icons/icon-512.png", "512x512", "any"],
      ["/icons/maskable-512.png", "512x512", "maskable"],
    ]);
  });

  it("offers shortcuts to pages every domain app has, one of them for adding the app's own noun", () => {
    const shortcuts = manifest.shortcuts ?? [];
    expect(shortcuts.map((s) => s.name)).toEqual(["Add a item", "Collection", "Alerts"]);
    const pages = [...navFor({ nav: undefined }).map((i) => i.href), "/add"];
    for (const s of shortcuts) expect(pages, s.url).toContain(s.url);
  });
});

describe("the shell's metadata", () => {
  const metadata = appMetadata(spec);

  it("links the manifest, the favicon, the 192 icon and the apple-touch icon", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
    expect(metadata.icons).toEqual({
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: "/icons/apple-touch-icon.png",
    });
  });

  it("keeps the names it had", () => {
    expect(metadata).toMatchObject({ title: "CollectCollect · Test", description: "A collection", applicationName: "CollectCollect Test", appleWebApp: { title: "CC Test" } });
  });

  it("links only what a visitor who has not signed in can fetch, or the login page and an installed app's splash would have no icon", () => {
    const icons = metadata.icons as { icon: Array<{ url: string }>; apple: string };
    for (const url of [metadata.manifest as string, ...icons.icon.map((i) => i.url), icons.apple, ...(domainManifest(spec).icons ?? []).map((i) => i.src)]) {
      expect(publicToAnyone(url), url).toBe(true);
    }
  });
});

describe("the shell's safety net", () => {
  it("loads /guard.js first, with the request's nonce, ahead of the theme script", async () => {
    const html = renderToStaticMarkup(await AppShell({ engine, fontClass: "font", children: null }));
    const head = /<head>(.*?)<\/head>/s.exec(html)?.[1] ?? "";
    const guard = /<script src="\/guard\.js" nonce="n0nce\+\/=" async=""><\/script>/.exec(head);
    expect(guard, head).not.toBeNull();
    expect(head.indexOf("/guard.js")).toBeLessThan(head.indexOf("data-scheme"));
  });

  it("tells a visitor without JavaScript what still works, first on the page and in the app's own name", async () => {
    const html = renderToStaticMarkup(await AppShell({ engine, fontClass: "font", children: null }));
    const body = html.slice(html.indexOf("<body"));
    expect(body.indexOf("<noscript>")).toBeGreaterThan(-1);
    expect(body.indexOf("<noscript>")).toBeLessThan(body.indexOf("<header"));
    expect(body).toContain("CollectCollect Test needs JavaScript to add, change or price anything.");
  });

  it("tells the guard the page started, and registers the service worker", async () => {
    const types = typesIn(await AppShell({ engine, fontClass: "font", children: null }));
    for (const component of [NoScriptNote, Started, ServiceWorker]) expect(types.has(component), component.name).toBe(true);
  });
});

describe("the service worker and the guard of a domain app", () => {
  it("names the worker's caches for the app, so one app never evicts another's, and never caches the API", async () => {
    const res = domainServiceWorkerResponse(spec);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/");
    const text = await res.text();
    expect(text).toContain("`collectcollect-testdomain-shell-${VERSION}`");
    expect(text).toContain('url.pathname.startsWith("/api/")');
    expect(await domainServiceWorkerResponse({ id: "other-app" }).text()).toContain("`collectcollect-other-app-shell-${VERSION}`");
  });

  it("precaches only what a signed-out visitor can fetch: the install fails on a 401 or a redirect, and the app would never install", async () => {
    const text = await domainServiceWorkerResponse(spec).text();
    const precached = /const PRECACHE = \[(.*?)\];/.exec(text)?.[1] ?? "";
    const urls = [...precached.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(urls).toContain("/icons/icon-192.png");
    // OFFLINE_URL is a constant in the worker, "/offline".
    for (const url of ["/offline", ...urls.filter((u) => u.startsWith("/"))]) expect(publicToAnyone(url), url).toBe(true);
  });

  it("serves the safety net with the app's name in its note", async () => {
    const res = domainGuardResponse(spec);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toBe(guardSource("CollectCollect Test"));
  });

  it("writes a name with punctuation the way the guard can take it, rather than leaving every page without a net", async () => {
    // The guard's own rule: letters, digits, spaces and a middle dot only, or it throws.
    expect(() => guardSource("CollectCollect Hot-wheels")).toThrow();
    expect(guardName({ name: "Hot-wheels" })).toBe("CollectCollect Hot wheels");
    expect(guardName({ name: "Lego (sets)" })).toBe("CollectCollect Lego sets");
    expect(guardName({ name: "!!!" })).toBe("CollectCollect");
    expect(guardName({ name: "A".repeat(80) }).length).toBeLessThanOrEqual(40);
    const hostile = await domainGuardResponse({ name: 'x"; alert(1); //' }).text();
    expect(hostile).not.toContain("alert(1)");
    expect(hostile).toContain("CollectCollect x alert 1 didn't finish loading");
  });
});
