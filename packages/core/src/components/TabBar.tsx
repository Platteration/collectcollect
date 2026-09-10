"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TabItem {
  href: string;
  label: string;
  icon: string;
  /** A count to show on this tab; nothing is drawn when it is absent or zero. */
  badge?: number;
}

/**
 * Phone navigation. A fixed bar within thumb reach, which is what makes the
 * installed app feel like an app rather than a page. Hidden from wide screens,
 * where the header row does the same job.
 *
 * Which destinations fit on a phone is the app's decision, not this
 * component's: it draws exactly what it is handed, in order.
 */
export function TabBar({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="tabbar fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur md:hidden"
      style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--background) 92%, transparent)" }}
      aria-label="Sections"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
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
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute right-1/2 top-1.5 translate-x-4 rounded-full bg-[var(--chart-bad)] px-1.5 text-[10px] font-medium text-white">
                    {item.badge > 9 ? "9+" : item.badge}
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
