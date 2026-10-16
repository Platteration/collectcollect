import vm from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The nonce the proxy mints for a request, as the layout reads it back.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-nonce": "n0nce+/=" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

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
