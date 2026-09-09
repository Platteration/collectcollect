"use client";

import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: string }> = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "system", label: "System", icon: "◐" },
];

const STORAGE_KEY = "theme";
const CHANGED = "collectcollect:theme";

/** Resolve and apply a preference. Kept in step with the inline script in the layout. */
function apply(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

function read(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
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

export function ThemeToggle() {
  // The preference lives in localStorage, which the server cannot see, so it is
  // read as external state with "system" as the server's answer. That keeps the
  // markup consistent through hydration without an effect writing state.
  const preference = useSyncExternalStore(subscribe, read, () => "system" as ThemePreference);

  // While following the system, follow it as it changes.
  useEffect(() => {
    if (preference !== "system") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const choose = (next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private browsing; the choice just will not persist */
    }
    apply(next);
    dispatchEvent(new Event(CHANGED));
  };

  return (
    <div className="flex items-center gap-0.5 rounded-lg border p-0.5" style={{ borderColor: "var(--line)" }} role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={preference === option.value}
          title={`${option.label} theme`}
          onClick={() => choose(option.value)}
          className="rounded-md px-2 py-1 text-xs transition"
          style={
            preference === option.value
              ? { background: "var(--surface-raised)", color: "var(--foreground)" }
              : { color: "var(--muted)" }
          }
        >
          <span aria-hidden>{option.icon}</span>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
