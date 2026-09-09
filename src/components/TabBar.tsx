"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TabItem {
  href: string;
  label: string;
  icon: string;
}

/**
 * Phone navigation. A fixed bar within thumb reach, which is what makes the
 * installed app feel like an app rather than a page. Hidden from wide screens,
 * where the header row does the same job.
 */
export function TabBar({ items, unread }: { items: TabItem[]; unread: number }) {
  const pathname = usePathname();
  // Seven destinations do not fit a phone. The rest are listed on the Settings
  // page, which is why the last tab is labelled More rather than Settings.
  const TABS = ["/", "/collection", "/sets", "/alerts", "/settings"];
  const shown = items
    .filter((i) => TABS.includes(i.href))
    .sort((a, b) => TABS.indexOf(a.href) - TABS.indexOf(b.href))
    .map((i) => (i.href === "/settings" ? { ...i, label: "More", icon: "☰" } : i));

  return (
    <nav
      className="tabbar fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur md:hidden"
      style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--background) 92%, transparent)" }}
      aria-label="Sections"
    >
      <ul className="mx-auto flex max-w-lg">
        {shown.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]"
                style={{ color: active ? "var(--foreground)" : "var(--muted)" }}
              >
                <span aria-hidden className="text-base leading-none">
                  {item.icon}
                </span>
                {item.label}
                {item.href === "/alerts" && unread > 0 && (
                  <span className="absolute right-1/2 top-1.5 translate-x-4 rounded-full bg-[var(--chart-bad)] px-1.5 text-[10px] font-medium text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
