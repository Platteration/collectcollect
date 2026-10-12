/** Coordinated hobby palettes. IDs and swatches retain existing saved choices.
 * The shared stylesheet changes aesthetic surfaces and accents, never financial,
 * categorical, rarity or grading-company colors.
 */
export interface ColorScheme {
  id: string;
  label: string;
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
