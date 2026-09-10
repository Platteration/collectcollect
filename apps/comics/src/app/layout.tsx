import { Barlow_Condensed } from "next/font/google";
import "./globals.css";
import { AppShell, appMetadata, appViewport } from "@collectcollect/core/pages/AppShell";
import { engine } from "@/lib/engine";

// Condensed display face for the hero value, item names and headings. The
// font call has to live in the layout file: Next resolves it at build time.
const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata = appMetadata(engine.spec);
export const viewport = appViewport(engine.spec);

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell engine={engine} fontClass={display.variable}>
      {children}
    </AppShell>
  );
}
