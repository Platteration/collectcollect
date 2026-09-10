"use client";

import { TabBar as Bar, type TabItem } from "@collectcollect/core/components/TabBar";

/**
 * Which of this app's destinations fit on a phone, in thumb order. Six do not,
 * and the ones left out are a tap away from the header on a wider screen.
 */
const TABS = ["/", "/inventory", "/spread", "/alerts", "/settings"];

export function SkinsTabBar({ items, unread }: { items: TabItem[]; unread: number }) {
  const shown = items
    .filter((i) => TABS.includes(i.href))
    .sort((a, b) => TABS.indexOf(a.href) - TABS.indexOf(b.href))
    .map((i) => (i.href === "/alerts" ? { ...i, badge: unread } : i.href === "/spread" ? { ...i, label: "Sell" } : i));
  return <Bar items={shown} />;
}
