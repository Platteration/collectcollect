import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { widgetEngine } from "./widgets";

// Pages that read the request or the router get stand-ins; nothing here navigates.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

const { offTheTabBar, navFor } = await import("../src/pages/AppShell");
const { SettingsPage } = await import("../src/pages/SettingsPage");
const { ReportPage } = await import("../src/pages/ReportPage");
const { AddItemFlow } = await import("../src/components/domain/AddItemFlow");
const { SignOut } = await import("../src/components/SignOut");

const inputs = (html: string) => [...html.matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag).filter((tag) => /type="file"/.test(tag));

describe("what a phone is shown beyond the tab bar", () => {
  it("lists Import, which the five tabs leave out", () => {
    expect(offTheTabBar({}).map((i) => i.href)).toEqual(["/import"]);
  });

  it("lists an app's own nav entries too, in nav order, ahead of Import", () => {
    const nav = [{ href: "/open", label: "Open", icon: "o" }, { href: "/wishlist", label: "Wishlist", icon: "w" }];
    expect(offTheTabBar({ nav }).map((i) => i.href)).toEqual(["/open", "/wishlist", "/import"]);
    // The same order the header's row uses.
    expect(navFor({ nav }).map((i) => i.href)).toEqual(["/", "/collection", "/open", "/wishlist", "/alerts", "/report", "/import", "/settings"]);
  });

  it("leaves out what an app puts on its tab bar, and never lists Settings on Settings", () => {
    expect(offTheTabBar({ tabs: ["/", "/collection", "/alerts", "/import", "/report"] }).map((i) => i.href)).toEqual([]);
    expect(offTheTabBar({ tabs: ["/", "/collection"] }).map((i) => i.href)).toEqual(["/alerts", "/report", "/import"]);
  });

  it("is on the Settings page as a navigation for phones, with a link to Import", () => {
    const html = renderToStaticMarkup(SettingsPage({ engine: widgetEngine() }));
    const nav = /<nav\b[^>]*aria-label="More sections"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
    expect(nav, "Settings has a 'More sections' navigation").not.toBeNull();
    expect(nav![0]).toMatch(/class="[^"]*\bmd:hidden\b/);
    expect(nav![1]).toContain("Go to");
    expect(nav![1]).toMatch(/<a [^>]*href="\/import"[^>]*>Import<\/a>/);
    // Nothing the tab bar already has.
    for (const href of ["/collection", "/alerts", "/report", "/settings"]) expect(nav![1]).not.toContain(`href="${href}"`);
  });

  it("is left off Settings when an app's tab bar already has everything", () => {
    const engine = widgetEngine();
    engine.spec.tabs = ["/", "/collection", "/alerts", "/report", "/import", "/settings"];
    expect(renderToStaticMarkup(SettingsPage({ engine }))).not.toContain("More sections");
  });
});

describe("the add page's photo controls", () => {
  const html = renderToStaticMarkup(createElement(AddItemFlow, { fields: [], noun: { singular: "widget", plural: "widgets" }, canIdentify: false, hasIdentify: false, locations: [] }));

  it("has a Take photo that opens the camera and a Choose photos that does not", () => {
    expect(html).toMatch(/<button[^>]*>\s*Take photo\s*<\/button>/);
    expect(html).toMatch(/<button[^>]*>\s*Choose photos\s*<\/button>/);
    const all = inputs(html);
    const withCapture = all.filter((tag) => /\bcapture=/.test(tag));
    const without = all.filter((tag) => !/\bcapture=/.test(tag));
    expect(withCapture).toHaveLength(1);
    expect(without).toHaveLength(1);
    const [camera, files] = [withCapture[0]!, without[0]!];
    expect(camera).toMatch(/capture="environment"/);
    expect(camera).not.toMatch(/\bmultiple\b/);
    expect(files).toMatch(/\bmultiple\b/);
    expect(files).not.toMatch(/\bcapture\b/);
  });

  it("never has one input that is both, which opens only the camera on Android", () => {
    for (const tag of inputs(html)) expect(/\bcapture=/.test(tag) && /\bmultiple\b/.test(tag), tag).toBe(false);
    expect(inputs(html)).toHaveLength(2);
  });
});

describe("the report on a phone", () => {
  it("scrolls the holdings table inside its own box, and lets it spill on paper", () => {
    const engine = widgetEngine();
    engine.repo.createItem({ name: "Gizmo", maker: "Acme" });
    const html = renderToStaticMarkup(ReportPage({ engine, searchParams: {} }));
    const wrapped = /<div class="([^"]*)"><table class="w-full text-sm">/.exec(html);
    expect(wrapped, "the Holdings table sits directly in a wrapper").not.toBeNull();
    expect(wrapped![1]!.split(" ")).toEqual(expect.arrayContaining(["overflow-x-auto", "print:overflow-visible"]));
  });
});

describe("the header's controls on a touch screen", () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, "../src/family-theme.css"), "utf8");
  /** The declarations a rule in the (pointer: coarse) block gives a selector. */
  const coarse = (selector: string) => {
    const block = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    return new RegExp(`${selector.replace(".", "\\.")} \\{([^}]*)\\}`).exec(block)?.[1] ?? "";
  };

  it("makes the theme buttons and Sign out at least 44 px (2.75rem) each way, for a finger and not a mouse", () => {
    expect(coarse(".cc-mode-choice")).toMatch(/width: 2\.75rem/);
    expect(coarse(".cc-mode-choice")).toMatch(/height: 2\.75rem/);
    expect(coarse(".cc-signout")).toMatch(/min-width: 2\.75rem/);
    expect(coarse(".cc-signout")).toMatch(/min-height: 2\.75rem/);
    // With a mouse the buttons stay the size they were.
    expect(css).toMatch(/\n\.cc-mode-choice \{[^}]*width: 2\.25rem; height: 2\.25rem/);
  });

  it("gives the Sign out button the class that rule is written for", () => {
    expect(renderToStaticMarkup(createElement(SignOut))).toMatch(/<button[^>]*class="[^"]*\bcc-signout\b/);
  });
});
