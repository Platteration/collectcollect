import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME } from "./color-schemes";

export type ThemePreference = "system" | "light" | "dark";
export const APPEARANCE_EVENT = "collectcollect:appearance";
const temporary = new Map<string, string>();
let printing = false;

export function normalizeTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function normalizeScheme(value: string | null): string {
  return COLOR_SCHEMES.some((scheme) => scheme.id === value) ? value! : DEFAULT_COLOR_SCHEME;
}

function stored(key: string): string | null {
  if (typeof window === "undefined") return null;
  if (temporary.has(key)) return temporary.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}

export const readTheme = (): ThemePreference => normalizeTheme(stored("theme"));
export const readScheme = (): string => normalizeScheme(stored("colorScheme"));
export const isTemporary = (): boolean => temporary.size > 0;

/** Legacy keys are retained: existing installations keep their choices. */
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    temporary.delete(key);
  } catch {
    // A blocked/quota-limited store must not undo the user's in-session choice.
    temporary.set(key, value);
  }
  applyAppearance();
  dispatchEvent(new Event(APPEARANCE_EVENT));
}

export const chooseTheme = (value: ThemePreference) => save("theme", normalizeTheme(value));
export const chooseScheme = (value: string) => save("colorScheme", normalizeScheme(value));

/** The shell subscribes on every route, not just while Settings is mounted. */
export function subscribeAppearance(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== "theme" && event.key !== "colorScheme") return;
    // Ignore sessionStorage events without reading a possibly blocked storage getter.
    try { if (event.storageArea && event.storageArea !== localStorage) return; } catch { return; }
    if (event.key === null) temporary.clear();
    else temporary.delete(event.key);
    applyAppearance();
    onChange();
  };
  addEventListener("storage", onStorage);
  addEventListener(APPEARANCE_EVENT, onChange);
  return () => {
    removeEventListener("storage", onStorage);
    removeEventListener(APPEARANCE_EVENT, onChange);
  };
}

/** Browser chrome uses the resolved palette's ground, rather than a hard-coded app color. */
export function applyAppearance(fallback?: { light: string; dark: string }) {
  if (typeof document === "undefined" || printing) return;
  const preference = readTheme();
  const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-scheme", readScheme());
  const color = getComputedStyle(root).getPropertyValue("--background").trim() || (dark ? fallback?.dark : fallback?.light);
  if (color) for (const tag of document.querySelectorAll('meta[name="theme-color"]')) {
    tag.setAttribute("content", color);
    tag.removeAttribute("media");
  }
}

/** Keep system mode live; print in light, then resolve the latest preference again. */
export function watchAppearance() {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => { if (readTheme() === "system") applyAppearance(); };
  const onBefore = () => {
    printing = true;
    document.documentElement.setAttribute("data-theme", "light");
  };
  const onAfter = () => { printing = false; applyAppearance(); };
  query.addEventListener("change", onSystem);
  addEventListener("beforeprint", onBefore);
  addEventListener("afterprint", onAfter);
  return () => {
    query.removeEventListener("change", onSystem);
    removeEventListener("beforeprint", onBefore);
    removeEventListener("afterprint", onAfter);
    if (printing) { printing = false; applyAppearance(); }
  };
}

/** Keep the non-modal palette panel inside the viewport, even beside Add/Sign out. */
export function positionAppearanceMenu(menu: HTMLDetailsElement) {
  if (!menu.open) return;
  const panel = menu.querySelector<HTMLElement>(".cc-palette-panel");
  if (!panel) return;
  panel.style.transform = "none";
  const bounds = panel.getBoundingClientRect();
  const shift = Math.max(16 - bounds.left, Math.min(0, innerWidth - 16 - bounds.right));
  panel.style.transform = `translateX(${shift}px)`;
  panel.style.maxHeight = `${Math.max(0, innerHeight - bounds.top - 16)}px`;
}
