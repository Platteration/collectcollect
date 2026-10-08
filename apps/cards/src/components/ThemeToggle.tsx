"use client";

import { ThemeToggle as Toggle } from "@collectcollect/core/components/ThemeToggle";

/** This app's own ground, which the browser chrome is asked to match. */
const THEME_COLOR = { light: "#f6f5f2", dark: "#08090a" };

export function ThemeToggle() {
  return <Toggle themeColor={THEME_COLOR} />;
}
