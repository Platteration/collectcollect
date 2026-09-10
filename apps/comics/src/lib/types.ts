/**
 * What a comic is, as far as this app is concerned: the vocabulary the form,
 * the filters, the Markdown mirror and the identification prompt share.
 */

export const KEY_FLAGS = {
  first_appearance: "First appearance",
  origin: "Origin",
  death: "Death",
  first_issue: "First issue",
  last_issue: "Last issue",
  cameo: "Cameo",
  first_cover: "First cover appearance",
  team_first: "First team appearance",
  new_costume: "New costume",
  wedding: "Wedding",
  classic_cover: "Classic cover",
  adaptation: "Movie or TV tie-in",
} as const;
export type KeyFlag = keyof typeof KEY_FLAGS;
export const KEY_FLAG_IDS = Object.keys(KEY_FLAGS) as KeyFlag[];

export const COMPANIES = { none: "Not graded", cgc: "CGC", cbcs: "CBCS", pgx: "PGX" } as const;
export type Company = keyof typeof COMPANIES;
export const COMPANY_IDS = Object.keys(COMPANIES) as Company[];

export const PAGE_QUALITIES = {
  white: "White",
  off_white_to_white: "Off-white to white",
  off_white: "Off-white",
  cream_to_off_white: "Cream to off-white",
  cream: "Cream",
  tan: "Tan",
  brittle: "Brittle",
} as const;
export type PageQuality = keyof typeof PAGE_QUALITIES;
export const PAGE_QUALITY_IDS = Object.keys(PAGE_QUALITIES) as PageQuality[];

export interface Comic {
  /** The series: "The Amazing Spider-Man". */
  title: string;
  publisher: string | null;
  /** As printed: "300", "1", "Annual 1", "-1". */
  issueNumber: string;
  volume: number | null;
  /** Year and month, "1988-05", or a year alone. */
  coverDate: string | null;
  /** A cover letter, a printing, a newsstand copy: "Cover B", "2nd printing", "Newsstand". */
  variant: string | null;
  keyFlags: KeyFlag[];
  /** Who or what the key issue is of: "Venom", "Wolverine". */
  keyOf: string | null;
  slabbed: boolean;
  gradingCompany: Company;
  /** The slab's grade, or the owner's estimate for a raw copy: "9.8", "4.0". */
  grade: string | null;
  certNumber: string | null;
  pageQuality: PageQuality | null;
  /** A witnessed signature: CGC Signature Series, CBCS Verified Signature. */
  signatureSeries: boolean;
}

export interface ComicSettings {
  gradingFee: number;
  readyMinUpside: number;
  readyMinUpsidePercent: number;
  /** A graded copy is worth the raw price × this, by grade, when no graded sale is known. */
  gradeMultipliers: Record<string, number>;
  /** A raw copy is worth the raw price × this, by the lowest grade bucket at or below its estimated grade. */
  rawGradeMultipliers: Record<string, number>;
  /** A witnessed signature multiplies the value by this. */
  signatureSeriesMultiplier: number;
}

export const DEFAULT_SETTINGS: ComicSettings = {
  gradingFee: 60,
  readyMinUpside: 75,
  readyMinUpsidePercent: 40,
  gradeMultipliers: {
    "Grade 9.9": 6,
    "Grade 9.8": 3,
    "Grade 9.6": 2,
    "Grade 9.4": 1.6,
    "Grade 9.2": 1.4,
    "Grade 9.0": 1.25,
    "Grade 8.5": 1.1,
    "Grade 8.0": 1,
    "Grade 7.5": 0.9,
    "Grade 7.0": 0.8,
    "Grade 6.0": 0.65,
    "Grade 5.0": 0.55,
    "Grade 4.0": 0.45,
    "Grade 3.0": 0.35,
    "Grade 2.0": 0.25,
  },
  rawGradeMultipliers: { "9.0": 1, "8.0": 0.8, "7.0": 0.65, "6.0": 0.5, "4.0": 0.35, "2.0": 0.2, "0.5": 0.1 },
  signatureSeriesMultiplier: 1.25,
};

export interface ComicQuery {
  title: string;
  publisher: string | null;
  issueNumber: string;
  volume: number | null;
  coverYear: number | null;
  variant: string | null;
  externalIds: Record<string, string>;
}

/** "9.8", "VF/NM 9.0", "9.0 VF/NM" → 9. Null when no number can be read. */
export function gradeNumber(grade: string | null | undefined): number | null {
  const m = (grade ?? "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0.5 && n <= 10 ? n : null;
}

/** "1988-05", "May 1988", "5/1988", "1988" → "1988-05" or "1988". Null when it is none of those. */
export function normalizeCoverDate(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthNumber = (name: string): number | null => {
    const i = months.indexOf(name.slice(0, 3).toLowerCase());
    return i === -1 ? null : i + 1;
  };
  const pad = (n: number | string) => String(n).padStart(2, "0");
  let m = text.match(/^(\d{4})(?:[-/.](\d{1,2}))?$/);
  if (m) return m[2] ? `${m[1]}-${pad(m[2])}` : m[1];
  m = text.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (m) return `${m[1]}-${m[2]}`;
  m = text.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[2]}-${pad(m[1])}`;
  m = text.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const month = monthNumber(m[1]);
    return month ? `${m[2]}-${pad(month)}` : null;
  }
  m = text.match(/^(\d{4})\s+([A-Za-z]{3,9})$/);
  if (m) {
    const month = monthNumber(m[2]);
    return month ? `${m[1]}-${pad(month)}` : null;
  }
  return null;
}

export function coverYear(coverDate: string | null | undefined): number | null {
  const m = (coverDate ?? "").match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}
