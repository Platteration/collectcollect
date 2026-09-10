import type { Metadata, Viewport } from "next";
import { Barlow_Condensed } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { SkinsTabBar } from "@/components/TabBar";
import { ThemeToggle } from "@/components/ThemeToggle";

// Condensed display face for the hero value, item names and headings.
const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CollectCollect · Skins",
  description: "Track what your CS2 inventory cost, what it is worth, and where it would sell for most.",
  applicationName: "CollectCollect Skins",
  appleWebApp: { capable: true, title: "CC Skins", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e13" },
  ],
};

/**
 * Resolve the stored preference to a concrete theme before the first paint, so
 * the page never flashes the wrong one. Everything else in the app, CSS
 * variables and Tailwind's dark: utilities alike, keys off this one attribute.
 */
const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("theme")||"system";var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){}})()`;

const NAV = [
  { href: "/", label: "Portfolio", icon: "▲" },
  { href: "/inventory", label: "Inventory", icon: "▦" },
  { href: "/alerts", label: "Alerts", icon: "◉" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" className={`${display.variable} h-full antialiased`} suppressHydrationWarning>
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
              <span aria-hidden className="inline-block h-6 w-4 rounded-sm bg-gradient-to-br from-sky-500 to-indigo-600 dark:from-white dark:to-neutral-500" />
              <span className="font-display text-xl font-semibold uppercase tracking-wide">
                CollectCollect<span style={{ color: "var(--muted)" }}> · Skins</span>
              </span>
            </Link>

            {/* The full row is for wide screens; phones get the tab bar below. */}
            <div className="ml-auto hidden items-center gap-0.5 text-sm md:flex">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-md px-2 py-1.5 hover:bg-[var(--surface-raised)] lg:px-3">
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2 md:ml-0">
              <ThemeToggle />
            </div>
          </nav>
        </header>

        <main className="safe-x mx-auto w-full max-w-6xl flex-1 py-6 pb-24 md:pb-6">{children}</main>

        <SkinsTabBar items={NAV.map(({ href, label, icon }) => ({ href, label, icon }))} unread={0} />

        <footer className="safe-x hidden py-6 text-center text-xs md:block" style={{ color: "var(--muted)" }}>
          Prices are market estimates and change constantly. Steam proceeds are wallet funds and cannot be withdrawn.
        </footer>
      </body>
    </html>
  );
}
