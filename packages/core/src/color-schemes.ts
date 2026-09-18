/**
 * The accent hues a person can pick between, independent of light/dark. Every
 * scheme touches only `--accent`/`--accent-ink`/`--accent-solid` in
 * `globals.css`; gain and loss colours (`--chart-good*`/`--chart-bad*`) never
 * vary by scheme, and no hue here sits in the green or red range those use.
 */
export interface ColorScheme {
  id: string;
  label: string;
  /** The light-mode accent, for painting a swatch dot in the picker. */
  swatch: string;
}

export const COLOR_SCHEMES: ColorScheme[] = [
  { id: "teal", label: "Teal", swatch: "#296f69" },
  { id: "amber", label: "Amber", swatch: "#a85c04" },
  { id: "sky", label: "Sky", swatch: "#2f6feb" },
  { id: "indigo", label: "Indigo", swatch: "#4f46e5" },
  { id: "violet", label: "Violet", swatch: "#7c3aed" },
  { id: "plum", label: "Plum", swatch: "#b23a72" },
  { id: "copper", label: "Copper", swatch: "#b4552c" },
  { id: "slate", label: "Slate", swatch: "#334155" },
];

export const DEFAULT_COLOR_SCHEME = "teal";
