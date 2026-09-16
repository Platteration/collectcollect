import type { Outlook } from "@/lib/analytics";
import { when } from "@/lib/format";
export function GradingProvenance({ outlook }: { outlook: Outlook }) {
  const p = outlook.provenance;
  if (!p) return null;
  return <p className="text-xs text-[var(--muted)]">
    Low outcome: {p.min === "observed" ? `reported price (${p.minSource ?? "recorded source"}, ${when(p.minAt)})` : "multiplier estimate or raw fallback"}.
    {" "}High outcome: {p.max === "observed" ? `reported price (${p.maxSource ?? "recorded source"}, ${when(p.maxAt)})` : "multiplier estimate"}.
    {p.likely && ` Photo-based outcome: ${p.likely === "observed" ? `reported price (${p.likelySource ?? "recorded source"}, ${when(p.likelyAt)})` : "multiplier estimate"}.`}
    {" "}Recorded {when(p.fetchedAt)}. Estimates and photo assessments are not guaranteed outcomes.
  </p>;
}
