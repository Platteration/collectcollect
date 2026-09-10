/** What a bottle is, as far as this app is concerned. */

export const REGIONS = {
  speyside: "Speyside",
  highland: "Highland",
  islay: "Islay",
  lowland: "Lowland",
  campbeltown: "Campbeltown",
  islands: "Islands",
  scotland_blend: "Scotland (blend / grain)",
  ireland: "Ireland",
  usa: "USA",
  japan: "Japan",
  taiwan: "Taiwan",
  india: "India",
  canada: "Canada",
  australia: "Australia",
  other: "Other",
} as const;
export type Region = keyof typeof REGIONS;
export const REGION_IDS = Object.keys(REGIONS) as Region[];

export const PACKAGING = { tube: "Tube", box: "Box", none: "None" } as const;
export type Packaging = keyof typeof PACKAGING;
export const PACKAGING_IDS = Object.keys(PACKAGING) as Packaging[];

export interface Bottle {
  /** "Ardbeg", "Buffalo Trace". */
  distillery: string;
  /** "Uigeadail", "12 Year Old", "Corryvreckan". */
  expression: string;
  /** Years, null for a no-age-statement bottling. */
  ageStatement: number | null;
  /** Distillation year. */
  vintage: number | null;
  bottlingYear: number | null;
  caskType: string | null;
  /** Percent. */
  abv: number | null;
  /** Millilitres. */
  bottleSize: number;
  /** "Bottle 123 of 2000" names one bottle; "Batch 12" names a run. */
  bottleNumber: string | null;
  /** Percent of the bottle left, for an opened one. */
  fillLevel: number | null;
  sealed: boolean;
  packaging: Packaging;
  region: Region | null;
  /** Set the day a bottle is opened; read-only in the form. */
  openedAt: string | null;
  /** What the bottle was worth the day it was opened; the value it keeps from then on. */
  frozenValue: number | null;
}

export type BottleSettings = Record<string, never>;

export interface BottleQuery {
  distillery: string;
  expression: string;
  ageStatement: number | null;
  vintage: number | null;
  bottlingYear: number | null;
  bottleSize: number;
}

/** "Bottle 123/2000", "123 of 2000", "No. 123/2000" name one bottle; "Batch 12", "L2023" name a run. */
export function isBottleNumber(text: string | null | undefined): boolean {
  return /^\s*(?:bottle|no\.?|#)?\s*\d+\s*(?:\/|of)\s*\d+\s*$/i.test(text ?? "");
}
