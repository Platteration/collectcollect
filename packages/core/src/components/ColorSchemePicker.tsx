"use client";

import { useEffect, useSyncExternalStore } from "react";
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME } from "../color-schemes";

const STORAGE_KEY = "colorScheme";
const CHANGED = "collectcollect:colorScheme";

const VALID_IDS = new Set(COLOR_SCHEMES.map((s) => s.id));

/** Resolve and apply a scheme. Kept in step with the inline script in the layout. */
function apply(id: string) {
  document.documentElement.setAttribute("data-scheme", id);
}

function read(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && VALID_IDS.has(stored) ? stored : DEFAULT_COLOR_SCHEME;
  } catch {
    return DEFAULT_COLOR_SCHEME;
  }
}

function subscribe(onChange: () => void) {
  // `storage` covers another tab; the custom event covers this one.
  addEventListener("storage", onChange);
  addEventListener(CHANGED, onChange);
  return () => {
    removeEventListener("storage", onChange);
    removeEventListener(CHANGED, onChange);
  };
}

/**
 * An accent-colour picker, saved on this device the same way the theme is.
 * Only `--accent`/`--accent-ink`/`--accent-solid` change between schemes —
 * gain and loss colours are fixed tokens, untouched by any scheme.
 */
export function ColorSchemePicker() {
  // Same reasoning as ThemeToggle: localStorage is invisible to the server,
  // so this is read as external state with the default as the server's
  // answer, keeping markup consistent through hydration.
  const scheme = useSyncExternalStore(subscribe, read, () => DEFAULT_COLOR_SCHEME);

  // The inline script sets the scheme for the first paint; this keeps the
  // document in step afterwards, including when another tab changes it.
  useEffect(() => {
    apply(scheme);
  }, [scheme]);

  const choose = (id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private browsing; the choice just will not persist */
    }
    apply(id);
    dispatchEvent(new Event(CHANGED));
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Color scheme">
      {COLOR_SCHEMES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={scheme === option.id}
          title={option.label}
          onClick={() => choose(option.id)}
          className="flex h-9 w-9 items-center justify-center rounded-full border transition"
          style={{
            borderColor: scheme === option.id ? option.swatch : "var(--line)",
            borderWidth: scheme === option.id ? 2 : 1,
          }}
        >
          <span aria-hidden className="block h-5 w-5 rounded-full" style={{ background: option.swatch }} />
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
