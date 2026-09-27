"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ColorSchemePicker } from "./ColorSchemePicker";
import { DEFAULT_COLOR_SCHEME } from "../color-schemes";
import {
  applyAppearance, chooseTheme, isTemporary, positionAppearanceMenu, readScheme, readTheme,
  subscribeAppearance, watchAppearance, type ThemePreference,
} from "../appearance";
import "../family-theme.css";

export type { ThemePreference } from "../appearance";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: string }> = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "system", label: "System", icon: "◐" },
];

/** Existing app wrappers keep their API; all six apps receive the same controls. */
export function ThemeToggle({ themeColor }: { themeColor: { light: string; dark: string } }) {
  const preference = useSyncExternalStore(subscribeAppearance, readTheme, () => "system" as ThemePreference);
  const scheme = useSyncExternalStore(subscribeAppearance, readScheme, () => DEFAULT_COLOR_SCHEME);
  const temporary = useSyncExternalStore(subscribeAppearance, isTemporary, () => false);
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => { applyAppearance(themeColor); }, [preference, scheme, themeColor]);
  useEffect(watchAppearance, []);
  useEffect(() => { if (menu.current) positionAppearanceMenu(menu.current); }, [preference, scheme, temporary]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    const position = () => { if (menu.current) positionAppearanceMenu(menu.current); };
    addEventListener("pointerdown", closeOutside);
    addEventListener("resize", position);
    return () => {
      removeEventListener("pointerdown", closeOutside);
      removeEventListener("resize", position);
    };
  }, []);

  return (
    <div className="cc-appearance">
      <div className="cc-mode-group" role="group" aria-label="Theme">
        {OPTIONS.map((option) => (
          <button key={option.value} type="button" aria-label={option.label}
            aria-pressed={preference === option.value} title={`${option.label} theme`}
            onClick={() => chooseTheme(option.value)} className="cc-mode-choice">
            <span aria-hidden>{option.icon}</span>
          </button>
        ))}
      </div>
      <details className="cc-palette-menu" ref={menu} onToggle={(event) => positionAppearanceMenu(event.currentTarget)} onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}>
        <summary aria-label="Appearance palettes" title="Appearance palettes"><span aria-hidden>◈</span></summary>
        <div className="cc-palette-panel">
          <h2>Appearance</h2>
          <p>One palette across your collection, portfolio, and tools. Light and dark stay separate choices.</p>
          <ColorSchemePicker />
          <p>Gains stay green. Losses stay red. Item artwork and grade labels keep their own colors.</p>
        </div>
      </details>
      {temporary && <span className="cc-appearance-warning" role="status">Appearance applies now, but cannot be saved on this device.</span>}
    </div>
  );
}
