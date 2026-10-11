"use client";

import { useSyncExternalStore } from "react";
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME } from "../color-schemes";
import { chooseScheme, readScheme, subscribeAppearance } from "../appearance";

/** One picker for the header and Settings, across every collecting hobby. */
export function ColorSchemePicker() {
  const scheme = useSyncExternalStore(subscribeAppearance, readScheme, () => DEFAULT_COLOR_SCHEME);
  return (
    <div className="cc-palette-grid" role="group" aria-label="Color scheme">
      {COLOR_SCHEMES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={scheme === option.id}
          title={option.label}
          onClick={() => chooseScheme(option.id)}
          className="cc-palette-choice"
        >
          <span aria-hidden className="cc-palette-swatch" style={{ background: option.swatch }} />
          <span>{option.label}</span>
          <span aria-hidden className="cc-palette-check">{scheme === option.id ? "✓" : ""}</span>
        </button>
      ))}
    </div>
  );
}
