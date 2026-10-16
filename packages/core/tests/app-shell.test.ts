import vm from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { domainAuth } from "../src/domain/auth";

// The nonce the proxy mints for a request, as the layout reads it back, and
// the cookies it came with (a test puts a session cookie here).
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "n0nce+/=" }),
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

const { AppShell, THEME_SCRIPT } = await import("../src/pages/AppShell");

const engine = {
  spec: {
    id: "testdomain",
    name: "Test",
    description: "A collection",
    theme: { light: "#ffffff", dark: "#000000" },
    noun: { singular: "item", plural: "items" },
  },
  alerts: { unreadCount: () => 0 },
  auth: { authEnabled: () => false },
} as unknown as Parameters<typeof AppShell>[0]["engine"];

/** Run the inline script the way a browser would before the first paint. */
function paint(storage: Record<string, string> | "blocked", prefersDark = false) {
  const attributes: Record<string, string> = { "data-theme": "light", "data-scheme": "teal" };
  const localStorage = {
    getItem(key: string) {
      if (storage === "blocked") throw new Error("SecurityError");
      return storage[key] ?? null;
    },
  };
  const document = { documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value; } } };
  const window = { matchMedia: (query: string) => ({ matches: prefersDark && query === "(prefers-color-scheme: dark)" }) };
  vm.runInNewContext(THEME_SCRIPT, { localStorage, document, window });
  return attributes;
}

describe("the shell every hobby's pages sit in", () => {
  it("hands its pre-paint script the request's nonce, which the content security policy requires of an inline script", async () => {
    const html = renderToStaticMarkup(await AppShell({ engine, fontClass: "font", children: null }));
    const inline = [...html.matchAll(/<script([^>]*)>([^<]*)<\/script>/g)].filter(([, , body]) => (body ?? "").length > 0);
    expect(inline).toHaveLength(1);
    expect(inline[0]![1]).toContain('nonce="n0nce+/="');
    expect(inline[0]![2]).toContain("data-scheme");
    // The palette the script would otherwise apply is the default until it runs.
    expect(html).toMatch(/<html[^>]* data-theme="light"[^>]* data-scheme="teal"/);
  });

  it("applies a stored theme and palette before the first paint", () => {
    expect(paint({ theme: "dark", colorScheme: "plum" })).toEqual({ "data-theme": "dark", "data-scheme": "plum" });
    expect(paint({ theme: "light", colorScheme: "copper" }, true)).toEqual({ "data-theme": "light", "data-scheme": "copper" });
  });

  it("follows the device when the theme is System or was never chosen, on the default palette", () => {
    expect(paint({}, true)).toEqual({ "data-theme": "dark", "data-scheme": "teal" });
    expect(paint({}, false)).toEqual({ "data-theme": "light", "data-scheme": "teal" });
    expect(paint({ theme: "system" }, true)).toEqual({ "data-theme": "dark", "data-scheme": "teal" });
  });

  it("leaves the server's defaults in place when the browser will not open its storage", () => {
    expect(paint("blocked", true)).toEqual({ "data-theme": "light", "data-scheme": "teal" });
  });
});

describe("the shell's own chrome", () => {
  const PASSWORD = "TESTSHELL_APP_PASSWORD";
  const auth = domainAuth("testshell", "TESTSHELL");
  afterEach(() => {
    delete process.env[PASSWORD];
    delete process.env.TESTSHELL_APP_SECRET;
    jar.clear();
  });

  /** The shell around a page, for a gate that is on, with the alert count's every read counted. */
  async function shell() {
    let opened = 0;
    const gated = { ...engine, alerts: { unreadCount: () => (opened++, 3) }, auth } as unknown as Parameters<typeof AppShell>[0]["engine"];
    const html = renderToStaticMarkup(await AppShell({ engine: gated, fontClass: "font", children: "PAGE" }));
    return { html, opened };
  }

  it("is not drawn for a visitor with no session, as on the login page or the offline notice, and the alerts are not read", async () => {
    process.env[PASSWORD] = "a-password-for-the-test";
    process.env.TESTSHELL_APP_SECRET = "a".repeat(64);
    for (const cookie of [undefined, "not-a-session"]) {
      if (cookie) jar.set(auth.SESSION_COOKIE, cookie);
      const { html, opened } = await shell();
      expect(html).toContain("PAGE");
      expect(html).toContain("CollectCollect");
      expect(html).not.toContain('href="/collection"');
      expect(html).not.toContain('href="/add"');
      expect(html).not.toContain("Sign out");
      expect(html).not.toContain('aria-label="Sections"');
      expect(opened).toBe(0);
      // The theme switch is the visitor's own, and stays.
      expect(html).toContain('aria-label="Theme"');
    }
  });

  it("is drawn, unread count and Sign out included, for a visitor with a session", async () => {
    process.env[PASSWORD] = "a-password-for-the-test";
    process.env.TESTSHELL_APP_SECRET = "a".repeat(64);
    jar.set(auth.SESSION_COOKIE, await auth.createToken());
    const { html, opened } = await shell();
    expect(html).toContain('href="/collection"');
    expect(html).toContain('href="/add"');
    expect(html).toContain("Sign out");
    expect(html).toContain('aria-label="Sections"');
    expect(opened).toBe(1);
  });

  it("labels the last tab More when Settings lists what the tab bar leaves out, as cards and skins do", async () => {
    const tabBar = (html: string) => /<nav\b[^>]*aria-label="Sections"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    const { html } = await shell();
    expect(tabBar(html)).toMatch(/<a [^>]*href="\/settings"[^>]*>[\s\S]*?More[\s\S]*?<\/a>/);
    expect(tabBar(html)).not.toContain(">Settings<");
    // An app whose tab bar has every destination has nothing more to list, and its tab says Settings.
    const everything = { ...engine, spec: { ...engine.spec, tabs: ["/", "/collection", "/alerts", "/report", "/import", "/settings"] } } as typeof engine;
    const all = renderToStaticMarkup(await AppShell({ engine: everything, fontClass: "font", children: null }));
    expect(tabBar(all)).toContain("Settings");
    expect(tabBar(all)).not.toContain("More");
  });

  it("is drawn for everyone when the app has no password, as before", async () => {
    const { html, opened } = await shell();
    expect(html).toContain('href="/add"');
    expect(html).not.toContain("Sign out");
    expect(opened).toBe(1);
  });
});
