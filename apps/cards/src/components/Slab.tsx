import { GRADING_COMPANIES } from "@/lib/types";
import { lookup } from "@collectcollect/core/lookup";

const COMPANY_CLASS: Record<string, string> = {
  PSA: "slab-psa",
  BGS: "slab-bgs",
  CGC: "slab-cgc",
  SGC: "slab-sgc",
  TAG: "slab-tag",
};

export function slabClass(company: string | null | undefined): string {
  return lookup(COMPANY_CLASS, (company ?? "").toUpperCase()) ?? "";
}

export function isKnownCompany(company: string | null | undefined): boolean {
  return GRADING_COMPANIES.includes((company ?? "") as (typeof GRADING_COMPANIES)[number]);
}
