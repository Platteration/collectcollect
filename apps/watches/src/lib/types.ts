/** What a watch is, as far as this app is concerned. */

export const MOVEMENTS = { automatic: "Automatic", manual: "Manual wind", quartz: "Quartz" } as const;
export type Movement = keyof typeof MOVEMENTS;
export const MOVEMENT_IDS = Object.keys(MOVEMENTS) as Movement[];

export const MATERIALS = {
  steel: "Stainless steel",
  yellow_gold: "Yellow gold",
  rose_gold: "Rose gold",
  white_gold: "White gold",
  platinum: "Platinum",
  titanium: "Titanium",
  ceramic: "Ceramic",
  bronze: "Bronze",
  two_tone: "Two-tone",
  resin: "Resin",
  other: "Other",
} as const;
export type Material = keyof typeof MATERIALS;
export const MATERIAL_IDS = Object.keys(MATERIALS) as Material[];

export const BOX_PAPERS = { both: "Box & papers", box: "Box only", papers: "Papers only", neither: "Neither" } as const;
export type BoxPapers = keyof typeof BOX_PAPERS;
export const BOX_PAPERS_IDS = Object.keys(BOX_PAPERS) as BoxPapers[];

export const CONDITIONS = { new: "New / unworn", excellent: "Excellent", good: "Good", fair: "Fair" } as const;
export type Condition = keyof typeof CONDITIONS;
export const CONDITION_IDS = Object.keys(CONDITIONS) as Condition[];

export interface ServiceEntry {
  /** YYYY-MM-DD */
  date: string;
  notes: string;
}

export interface Watch {
  brand: string;
  model: string;
  referenceNumber: string | null;
  /** Private: kept out of the Markdown copy and the exports unless the owner opts in. */
  serialNumber: string | null;
  movement: Movement | null;
  caliber: string | null;
  /** Millimetres. */
  caseSize: number | null;
  caseMaterial: Material | null;
  dial: string | null;
  braceletStrap: string | null;
  year: number | null;
  boxPapers: BoxPapers;
  condition: Condition;
  serviceHistory: ServiceEntry[] | null;
}

export interface WatchSettings {
  /** Shown on the appraisal report. */
  insurer: string;
  policyNumber: string;
}

export const DEFAULT_SETTINGS: WatchSettings = { insurer: "", policyNumber: "" };

export interface WatchQuery {
  brand: string;
  model: string;
  referenceNumber: string | null;
}

/** Service entries however they arrived: sorted by date, dated, with something said. */
export function cleanServiceHistory(input: unknown): ServiceEntry[] {
  if (input === null || input === undefined || input === "") return [];
  const list = Array.isArray(input) ? input : typeof input === "string" ? parseServiceText(input) : null;
  if (!list) throw new Error("Service history should be a list of dated entries");
  const out: ServiceEntry[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") throw new Error("Service history should be a list of dated entries");
    const entry = raw as Record<string, unknown>;
    const date = typeof entry.date === "string" ? entry.date.trim().slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("Every service entry needs a date (YYYY-MM-DD)");
    const notes = typeof entry.notes === "string" ? entry.notes.trim() : "";
    if (!notes) throw new Error("Every service entry needs a note: what was done, and by whom");
    out.push({ date, notes });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** "2021-03-04: Full service at Rolex Geneva; 2024-01-10: Crystal replaced" — the way a spreadsheet cell says it. */
function parseServiceText(text: string): unknown[] | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown[];
    } catch {
      return null;
    }
  }
  return trimmed
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(\d{4}-\d{2}-\d{2})\s*[:\-–]\s*(.+)$/);
      return m ? { date: m[1], notes: m[2] } : { date: "", notes: part };
    });
}
