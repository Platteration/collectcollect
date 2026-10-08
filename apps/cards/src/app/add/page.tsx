import Link from "next/link";
import { AddCardFlow } from "@/components/AddCardFlow";
import { isClaudeConfigured } from "@/lib/identify/claude";
import { getGoalItem } from "@/lib/goals";

export const dynamic = "force-dynamic";

export default async function AddPage({ searchParams }: { searchParams: Promise<{ goalItem?: string }> }) {
  const { goalItem } = await searchParams;
  const wanted = typeof goalItem === "string" ? getGoalItem(goalItem) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Add cards</h1>
        <span className="flex gap-4 text-sm">
          <Link href="/scan" className="underline decoration-dotted">
            Scanning a whole stack? Use scan mode
          </Link>
          <Link href="/import" className="underline decoration-dotted">
            Import a CSV
          </Link>
        </span>
      </div>
      {wanted && <p className="card-surface p-3 text-sm">Adding {wanted.name} toward your collecting goal. Check the actual printing, condition and purchase price before saving. <Link className="underline" href="/goals">Back to goals</Link></p>}
      <AddCardFlow claudeConfigured={isClaudeConfigured()} initialInput={wanted ? { ...wanted, quantity: Math.max(1, wanted.remaining) } : undefined} />
    </div>
  );
}
