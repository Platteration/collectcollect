import type { CertVerification, CertVerifier, ItemRecord } from "@collectcollect/core/domain/spec";
import { COMPANIES, type Comic, type Company } from "./types";

/**
 * Certificate verification: the grading company's register, asked whether
 * the number on the label is real and describes this comic.
 *
 * What is implemented is the interface and the part that needs no network:
 * whether the number even has the shape the company prints. A live lookup
 * is a TODO, because neither CGC nor CBCS publishes an API; their lookup
 * pages are HTML forms, and scraping them is brittle and against their
 * terms. Until then the answer is "unknown" with a link to check by hand,
 * and "mismatch" only when the number cannot be one of theirs.
 */

interface CertFormat {
  pattern: RegExp;
  example: string;
  /** Where a person checks it; the number goes on the end when the page takes one. */
  register: string;
}

export const CERT_FORMATS: Record<Exclude<Company, "none">, CertFormat> = {
  // CGC prints a seven-digit submission number, a dash and a three-digit item number; older labels have ten digits run together.
  cgc: { pattern: /^\d{7}-\d{3}$|^\d{10}$/, example: "1234567-001", register: "https://www.cgccomics.com/certlookup/" },
  // CBCS numbers are a two-digit year prefix, a dash and an alphanumeric block, sometimes with a dash and item number.
  cbcs: { pattern: /^\d{2}-[0-9A-Z]{6,9}(?:-[0-9A-Z]{2,4})?$/i, example: "19-1A2B3C4D-001", register: "https://cbcscomics.com/grading-verification?cert=" },
  pgx: { pattern: /^\d{6,10}$/, example: "12345678", register: "https://www.pgxcomics.com/" },
};

export async function verifyCert(item: ItemRecord<Comic>): Promise<CertVerification> {
  if (!item.slabbed) return { status: "unknown", detail: "A raw comic has no certificate to check." };
  if (item.gradingCompany === "none") return { status: "unknown", detail: "Say which company graded it first." };
  const cert = (item.certNumber ?? "").trim();
  if (!cert) return { status: "unknown", detail: "No cert number is recorded for this slab." };
  const company = COMPANIES[item.gradingCompany];
  const format = CERT_FORMATS[item.gradingCompany];
  if (!format.pattern.test(cert)) {
    return { status: "mismatch", detail: `${cert} does not look like a ${company} number (theirs read like ${format.example}). Check the label.` };
  }
  // TODO: look the number up on the company's register and compare title, issue and grade.
  const link = item.gradingCompany === "cbcs" || item.gradingCompany === "cgc" ? `${format.register}${item.gradingCompany === "cbcs" ? encodeURIComponent(cert) : ""}` : format.register;
  return {
    status: "unknown",
    detail: `${cert} has the shape of a ${company} number. A live lookup against ${company}'s register is not implemented yet; check it by hand at ${link}`,
  };
}

export const certVerifier: CertVerifier<Comic> = {
  label: "the grading company",
  note: "Checks that the cert number has the shape CGC, CBCS or PGX print. A live lookup against their registers is not implemented yet, so a real number answers \"unknown\" with a link to check by hand.",
  applies: (c) => c.slabbed,
  verify: verifyCert,
};
