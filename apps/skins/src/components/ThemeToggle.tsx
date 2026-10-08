"use client";

import { ThemeToggle as Toggle } from "@collectcollect/core/components/ThemeToggle";

/** This app's own ground, which the browser chrome is asked to match. */
const THEME_COLOR = { light: "#f4f5f7", dark: "#0b0e13" };

export function ThemeToggle() {
  return <Toggle themeColor={THEME_COLOR} />;
}
