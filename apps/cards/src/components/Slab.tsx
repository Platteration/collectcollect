import { GRADING_COMPANIES } from "@/lib/types";

const COMPANY_CLASS: Record<string, string> = {
  PSA: "slab-psa",
  BGS: "slab-bgs",
  CGC: "slab-cgc",
  SGC: "slab-sgc",
  TAG: "slab-tag",
};

export function slabClass(company: string | null | undefined): string {
  return COMPANY_CLASS[(company ?? "").toUpperCase()] ?? "";
}

export function isKnownCompany(company: string | null | undefined): boolean {
  return GRADING_COMPANIES.includes((company ?? "") as (typeof GRADING_COMPANIES)[number]);
}

/**
 * Wraps a card image in a slab-style frame with the grading label on top,
 * so graded cards look like what the owner actually holds.
 */
export function Slab({
  company,
  grade,
  certNumber,
  children,
  compact = false,
}: {
  company: string | null;
  grade: string;
  certNumber?: string | null;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`slab ${slabClass(company)} flex flex-col`}>
      <div className={`slab-label flex items-baseline justify-between gap-2 ${compact ? "text-[9px] leading-tight" : "text-xs"}`}>
        <span className="truncate">{company ?? "Graded"}</span>
        <span className="shrink-0 font-bold">{grade}</span>
      </div>
      <div className="overflow-hidden rounded-b-[0.35rem] bg-white/60 dark:bg-black/30">{children}</div>
      {!compact && certNumber && (
        <div className="px-1 pt-1 text-center text-[10px] tracking-wide text-neutral-500">CERT {certNumber}</div>
      )}
    </div>
  );
}
