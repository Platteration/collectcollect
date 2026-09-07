import type { Metadata } from "next";
import { Barlow_Condensed } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// Condensed display face for the hero value, card names and headings.
const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CollectCollect",
  description: "Photograph, identify, and price your trading cards.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-black/10 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-neutral-900/80">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-6 w-4 rounded-sm bg-gradient-to-br from-amber-500 to-rose-500" />
              <span className="font-display text-xl font-semibold uppercase tracking-wide">CollectCollect</span>
            </Link>
            <div className="ml-auto flex items-center gap-0.5 text-sm">
              <Link href="/" className="rounded-md px-2 py-1.5 hover:bg-black/5 sm:px-3 dark:hover:bg-white/10">
                Portfolio
              </Link>
              <Link href="/collection" className="rounded-md px-2 py-1.5 hover:bg-black/5 sm:px-3 dark:hover:bg-white/10">
                Collection
              </Link>
              <Link href="/report" className="rounded-md px-2 py-1.5 hover:bg-black/5 sm:px-3 dark:hover:bg-white/10">
                Report
              </Link>
              <Link href="/settings" className="rounded-md px-2 py-1.5 hover:bg-black/5 sm:px-3 dark:hover:bg-white/10">
                Settings
              </Link>
            </div>
            <Link href="/add" className="btn-primary whitespace-nowrap">
              + Add<span className="hidden sm:inline">&nbsp;cards</span>
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="px-4 py-6 text-center text-xs text-neutral-500">
          Prices are market estimates from third-party sources and change daily. Graded estimates marked
          “est.” are derived from multipliers you control in Settings.
        </footer>
      </body>
    </html>
  );
}
