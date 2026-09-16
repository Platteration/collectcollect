import type { CardInput, Identification } from "./types";

export type ScanDraftStatus = "queued" | "identifying" | "ready" | "review" | "failed" | "committed" | "discarded";
export interface ScanDraft {
  id: string;
  uploads: string[];
  accentColor: string | null;
  input: Partial<CardInput>;
  identification: Identification | null;
  hint: string;
  status: ScanDraftStatus;
  message: string | null;
  revision: number;
  cardId: number | null;
  result: "created" | "merged" | null;
  createdAt: string;
  updatedAt: string;
}

export function inputFromIdentification(id: Identification): CardInput {
  const grade = Number((id.condition_assessment?.estimated_grade_low ?? "").replace(/[^0-9.]/g, ""));
  return {
    game: id.game, name: id.name, sport: id.sport, setName: id.set_name, setCode: id.set_code,
    cardNumber: id.card_number, year: id.year, rarity: id.rarity, variant: id.variant,
    language: id.language, manufacturer: id.manufacturer,
    condition: !Number.isFinite(grade) || grade <= 0 || grade >= 8 ? "NM" : grade >= 6 ? "LP" : grade >= 4 ? "MP" : grade >= 2 ? "HP" : "DMG",
    gradingCompany: id.grading.company, grade: id.grading.grade, certNumber: id.grading.cert_number,
    notes: id.condition_notes ? `Condition notes: ${id.condition_notes}` : null,
  };
}
