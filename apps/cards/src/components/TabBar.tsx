"use client";

import { TabBar as Bar } from "@collectcollect/core/components/TabBar";

export interface TabItem {
  href: string;
  label: string;
  icon: string;
}

/**
 * Which of this app's destinations fit on a phone. Seven do not, so the rest
 * are listed on the Settings page — which is why the last tab is labelled More
 * rather than Settings.
 */
const TABS = ["/", "/collection", "/sets", "/alerts", "/settings"];

export function TabBar({ items, unread }: { items: TabItem[]; unread: number }) {
  const shown = items
    .filter((i) => TABS.includes(i.href))
    .sort((a, b) => TABS.indexOf(a.href) - TABS.indexOf(b.href))
    .map((i) =>
      i.href === "/settings"
        ? { ...i, label: "More", icon: "☰" }
        : i.href === "/alerts"
          ? { ...i, badge: unread }
          : i,
    );
  return <Bar items={shown} />;
}
