import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { DomainSpec, NavItem } from "../domain/spec";
import { SignOut } from "../components/SignOut";
import { TabBar } from "../components/TabBar";
import { ThemeToggle } from "../components/ThemeToggle";

/**
 * The frame every page of a domain app sits in: header with the wide-screen
 * nav, the page, the phone tab bar and a footer. An app's layout renders this
 * around its children and keeps only what Next insists lives in the layout
 * file itself: the font call and the stylesheet import.
 */

/**
 * Resolve the stored preference to a concrete theme before the first paint, so
 * the page never flashes the wrong one. Everything else in the app, CSS
 * variables and Tailwind's dark: utilities alike, keys off this one attribute.
 */
const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("theme")||"system";var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){}})()`;

const STANDARD_NAV: NavItem[] = [
  { href: "/", label: "Portfolio", icon: "▲" },
  { href: "/collection", label: "Collection", icon: "▦" },
  { href: "/alerts", label: "Alerts", icon: "◉" },
  { href: "/report", label: "Report", icon: "▤" },
  { href: "/import", label: "Import", icon: "↧" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

const STANDARD_TABS = ["/", "/collection", "/alerts", "/report", "/settings"];

type Spec = Pick<DomainSpec, "id" | "name" | "description" | "nav" | "tabs" | "theme" | "noun">;

/** The little an engine has to offer for the frame to draw; any domain's engine does. */
export interface ShellEngine {
  spec: Spec;
  alerts: { unreadCount(): number };
  auth: { authEnabled(): boolean };
}

/** The nav in order: the standard pages with the app's own slotted in after the collection. */
export function navFor(spec: Pick<Spec, "nav">): NavItem[] {
  const extra = spec.nav ?? [];
  return [...STANDARD_NAV.slice(0, 2), ...extra, ...STANDARD_NAV.slice(2)];
}

export function appMetadata(spec: Spec): Metadata {
  return {
    title: `CollectCollect · ${spec.name}`,
    description: spec.description,
    applicationName: `CollectCollect ${spec.name}`,
    appleWebApp: { capable: true, title: `CC ${spec.name}`, statusBarStyle: "default" },
  };
}

export function appViewport(spec: Spec): Viewport {
  return {
    viewportFit: "cover",
    width: "device-width",
    initialScale: 1,
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: spec.theme.light },
      { media: "(prefers-color-scheme: dark)", color: spec.theme.dark },
    ],
  };
}

export function AppShell({ engine, fontClass, footer, children }: { engine: ShellEngine; fontClass: string; footer?: string; children: React.ReactNode }) {
  const { spec } = engine;
  const unread = engine.alerts.unreadCount();
  const nav = navFor(spec);
  const tabOrder = spec.tabs ?? STANDARD_TABS;
  const tabs = nav
    .filter((i) => tabOrder.includes(i.href))
    .sort((a, b) => tabOrder.indexOf(a.href) - tabOrder.indexOf(b.href))
    .map((i) => (i.href === "/alerts" ? { ...i, badge: unread } : i));

  return (
    <html lang="en" data-theme="light" className={`${fontClass} h-full antialiased`} suppressHydrationWarning>
      {/* eslint-disable-next-line @next/next/no-head-element -- an App Router layout's head, not a pages/ one; the lint rule keys off this folder's name */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <header
          className="safe-top sticky top-0 z-20 border-b backdrop-blur"
          style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--background) 88%, transparent)" }}
        >
          <nav className="safe-x mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span aria-hidden className="brand-mark inline-block h-6 w-4 rounded-sm" />
              <span className="font-display text-xl font-semibold uppercase tracking-wide">
                CollectCollect<span style={{ color: "var(--muted)" }}> · {spec.name}</span>
              </span>
            </Link>

            {/* The full row is for wide screens; phones get the tab bar below. */}
            <div className="ml-auto hidden items-center gap-0.5 text-sm md:flex">
              {nav.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-md px-2 py-1.5 hover:bg-[var(--surface-raised)] lg:px-3">
                  {item.label}
                  {item.href === "/alerts" && unread > 0 && (
                    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--chart-bad)] px-1.5 text-xs font-medium text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Link>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2 md:ml-0">
              <ThemeToggle themeColor={spec.theme} />
              {engine.auth.authEnabled() && <SignOut />}
              <Link href="/add" className="btn-primary whitespace-nowrap">
                + Add
              </Link>
            </div>
          </nav>
        </header>

        <main className="safe-x mx-auto w-full max-w-6xl flex-1 py-6 pb-24 md:pb-6">{children}</main>

        <TabBar items={tabs} />

        <footer className="safe-x hidden py-6 text-center text-xs md:block" style={{ color: "var(--muted)" }}>
          {footer ?? "Values are estimates from the sources you have configured, and change. Nothing here leaves this machine unless you send it."}
        </footer>
      </body>
    </html>
  );
}
