import type { CardInput, CardRecord, GradingReport } from "../types";
import { agencyOf } from "./agencies";

/**
 * What a fetched report changes on the card: the company, the grade and the
 * cert always, and the report itself. The card's identity fields only when
 * asked, and only where the card has none: PSA's "Subject" is a product
 * string, not the printed name, and a changed identity would make the price
 * sources search afresh. The photo is never touched.
 */
export function applyReport(card: CardRecord, report: GradingReport, opts: { identity?: boolean } = {}): Partial<CardInput> {
  const patch: Partial<CardInput> = {
    gradingCompany: report.company,
    grade: report.grade ?? card.grade,
    certNumber: report.cert,
    gradingReport: report,
    gradingStatus: "undecided",
  };
  const i = report.identity;
  if (opts.identity && i) {
    const blank = (v: string | null) => !v || !v.trim();
    if (blank(card.cardNumber) && i.cardNumber) patch.cardNumber = i.cardNumber;
    if (card.year === null && i.year && /^\d{4}$/.test(i.year)) patch.year = Number(i.year);
    if (blank(card.variant) && i.variety) patch.variant = i.variety;
    if (card.game === "sports" && blank(card.manufacturer) && i.brand) patch.manufacturer = i.brand;
    if (blank(card.setName)) {
      const set = [i.year, i.brand, i.variety].filter(Boolean).join(" ");
      if (set) patch.setName = set;
    }
  }
  return patch;
}

/**
 * A report with nothing in it but the cert and the grade, for a slab recorded
 * by hand: what a returned submission leaves behind, which the card page then
 * links to the company's public report. Null for a company with no report.
 */
export function manualReport(company: string, cert: string, grade: string | null, checkedAt = new Date().toISOString()): GradingReport | null {
  const agency = agencyOf(company);
  if (!agency) return null;
  return {
    company: agency.id,
    cert,
    source: "manual",
    checkedAt,
    label: null,
    grade,
    gradeText: null,
    gradedAt: null,
    subgrades: null,
    tag: null,
    population: null,
    images: null,
    url: agency.reportUrl(cert),
    identity: null,
  };
}
