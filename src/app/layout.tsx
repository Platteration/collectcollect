import type { Metadata, Viewport } from "next";
import { Barlow_Condensed } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { unreadCount } from "@/lib/alerts";
import { authEnabled } from "@/lib/auth";
import { SignOut } from "@/components/SignOut";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TabBar } from "@/components/TabBar";
import { ServiceWorker } from "@/components/ServiceWorker";

// Condensed display face for the hero value, card names and headings.
const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CollectCollect",
  description: "Photograph, identify, and price your trading cards.",
  applicationName: "CollectCollect",
  appleWebApp: { capable: true, title: "CollectCollect", statusBarStyle: "black-translucent" },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  // Fill the screen on a phone, including behind the notch.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
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
  { href: "/collection", label: "Collection", icon: "▦" },
  { href: "/sets", label: "Sets", icon: "◫" },
  { href: "/submissions", label: "Grading", icon: "◈" },
  { href: "/alerts", label: "Alerts", icon: "◉" },
  { href: "/report", label: "Report", icon: "▤" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  const unread = unreadCount();
  return (
    <html lang="en" data-theme="light" className={`${display.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ServiceWorker />
        <header className="sticky top-0 z-20 border-b backdrop-blur" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--background) 88%, transparent)" }}>
          <nav className="safe-x mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-6 w-4 rounded-sm bg-gradient-to-br from-amber-500 to-rose-500 dark:from-white dark:to-neutral-500" />
              <span className="font-display text-xl font-semibold uppercase tracking-wide">CollectCollect</span>
            </Link>

            {/* The full row is for wide screens; phones get the tab bar below. */}
            <div className="ml-auto hidden items-center gap-0.5 text-sm md:flex">
              {NAV.map((item) => (
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
              <ThemeToggle />
              {authEnabled() && <SignOut />}
              <Link href="/add" className="btn-primary whitespace-nowrap">
                + Add<span className="hidden sm:inline">cards</span>
              </Link>
            </div>
          </nav>
        </header>

        <main className="safe-x mx-auto w-full max-w-6xl flex-1 py-6 pb-24 md:pb-6">{children}</main>

        <TabBar items={NAV.map(({ href, label, icon }) => ({ href, label, icon }))} unread={unread} />

        <footer className="safe-x hidden py-6 text-center text-xs md:block" style={{ color: "var(--muted)" }}>
          Prices are market estimates from third-party sources and change daily. Graded estimates marked “est.” are
          derived from multipliers you control in Settings.
        </footer>
      </body>
    </html>
  );
}
