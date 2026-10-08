import { lookup } from "@collectcollect/core/lookup";
import { GRADING_AGENCIES, type GradingAgency } from "../types";

/**
 * What this app knows about each grading company's public report: how its
 * cert numbers look, where the report lives, and which of the report's blocks
 * the company publishes. Nothing here fetches anything; PSA's lookup lives in
 * ./psa and every other company is a link the owner follows.
 */
export interface AgencyInfo {
  id: GradingAgency;
  label: string;
  /** What a cert number of this company looks like; nothing else reaches a URL. */
  certPattern: RegExp;
  certHint: string;
  /** Which subgrades the report carries: none, the four (front only), or the four for both sides. */
  subgrades: "none" | "four" | "eight";
  /** Whether the report carries TAG's 1000-point score and its breakdown. */
  tag: boolean;
  /** Label variants the company prints, offered on the report form. */
  labels: string[];
  /** Whether this app can fetch the report itself (PSA's API). */
  lookup: boolean;
  /** Whether the cert can only be entered on the agency's own page rather than put in a link. */
  formOnly: boolean;
  linkText: string;
  reportUrl(cert: string | null | undefined): string;
}

const cleaned = (info: Pick<AgencyInfo, "certPattern">, cert: string | null | undefined): string | null => {
  const text = (cert ?? "").trim();
  return text && info.certPattern.test(text) ? text : null;
};

export const AGENCIES: Record<GradingAgency, AgencyInfo> = {
  PSA: {
    id: "PSA",
    label: "PSA",
    certPattern: /^\d{8,10}$/,
    certHint: "8 to 10 digits",
    subgrades: "none",
    tag: false,
    labels: ["Standard"],
    lookup: true,
    formOnly: false,
    linkText: "View on PSA",
    reportUrl(cert) {
      const c = cleaned(this, cert);
      return c ? `https://www.psacard.com/cert/${c}/psa` : "https://www.psacard.com/cert";
    },
  },
  BGS: {
    id: "BGS",
    label: "Beckett",
    certPattern: /^\d{7,12}$/,
    certHint: "the serial on the label",
    subgrades: "four",
    tag: false,
    labels: ["Black Label", "Gold Label"],
    lookup: false,
    formOnly: false,
    linkText: "View on Beckett",
    reportUrl(cert) {
      const c = cleaned(this, cert);
      // Beckett's lookup takes the serial without the label's leading zeros.
      return c ? `https://www.beckett.com/grading/card-lookup?item_type=BGS&item_id=${c.replace(/^0+(?=\d)/, "")}` : "https://www.beckett.com/grading/card-lookup";
    },
  },
  CGC: {
    id: "CGC",
    label: "CGC",
    certPattern: /^\d{10,13}$/,
    certHint: "10 to 13 digits",
    subgrades: "four",
    tag: false,
    labels: ["Pristine"],
    lookup: false,
    formOnly: false,
    linkText: "View on CGC",
    reportUrl(cert) {
      const c = cleaned(this, cert);
      return c ? `https://www.cgccards.com/certlookup/${c}/` : "https://www.cgccards.com/certlookup/";
    },
  },
  SGC: {
    id: "SGC",
    label: "SGC",
    certPattern: /^(\d{7}|[A-Za-z0-9]{7}-[A-Za-z0-9]{3})$/,
    certHint: "7 digits, or 7-3 characters on an older label",
    subgrades: "none",
    tag: false,
    labels: [],
    lookup: false,
    formOnly: true,
    linkText: "Look up on SGC",
    reportUrl: () => "https://www.gosgc.com/cert-code-lookup",
  },
  TAG: {
    id: "TAG",
    label: "TAG",
    certPattern: /^[A-Za-z]\d{7}$/,
    certHint: "a letter and 7 digits, like A1234567",
    subgrades: "none",
    tag: true,
    labels: ["Pristine", "Gem Mint"],
    lookup: false,
    formOnly: false,
    linkText: "View the DIG report on TAG",
    reportUrl(cert) {
      const c = cleaned(this, cert);
      return c ? `https://my.taggrading.com/card/${c.toUpperCase()}` : "https://taggrading.com/pages/cert-search";
    },
  },
  ACE: {
    id: "ACE",
    label: "ACE",
    certPattern: /^\d{4,8}$/,
    certHint: "4 to 8 digits",
    subgrades: "four",
    tag: false,
    labels: [],
    lookup: false,
    formOnly: false,
    linkText: "View on ACE",
    reportUrl(cert) {
      const c = cleaned(this, cert);
      return c ? `https://acegrading.com/cert/${c}` : "https://acegrading.com/cert";
    },
  },
  AGS: {
    id: "AGS",
    label: "AGS",
    certPattern: /^\d{1,8}$/,
    certHint: "up to 8 digits",
    subgrades: "eight",
    tag: false,
    labels: [],
    lookup: false,
    formOnly: false,
    linkText: "View on AGS",
    reportUrl(cert) {
      const c = cleaned(this, cert);
      return c ? `https://agscard.com/feed/${c.padStart(8, "0")}/view` : "https://agscard.com";
    },
  },
};

/** The agency a company name means, however it is cased; null for "Other" or a blank. */
export function agencyOf(company: string | null | undefined): AgencyInfo | null {
  return lookup(AGENCIES, (company ?? "").trim().toUpperCase()) ?? null;
}

export function isAgency(company: string | null | undefined): company is GradingAgency {
  return agencyOf(company) !== null;
}

/** Whether a cert number has the shape this company's certs have. */
export function isValidCert(company: string | null | undefined, cert: string | null | undefined): boolean {
  const agency = agencyOf(company);
  return Boolean(agency && cleaned(agency, cert));
}

/** The public report for a slab, or the agency's lookup page when the cert is missing or malformed; null for a company with none. */
export function reportUrlFor(company: string | null | undefined, cert: string | null | undefined): string | null {
  return agencyOf(company)?.reportUrl(cert) ?? null;
}

export { GRADING_AGENCIES };
