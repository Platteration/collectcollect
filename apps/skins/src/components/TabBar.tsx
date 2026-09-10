"use client";

import { TabBar as Bar, type TabItem } from "@collectcollect/core/components/TabBar";

/** Which of this app's destinations fit on a phone, in thumb order. */
const TABS = ["/", "/inventory", "/import", "/settings"];

export function SkinsTabBar({ items }: { items: TabItem[] }) {
  const shown = items.filter((i) => TABS.includes(i.href)).sort((a, b) => TABS.indexOf(a.href) - TABS.indexOf(b.href));
  return <Bar items={shown} />;
}
