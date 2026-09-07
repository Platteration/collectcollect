import Link from "next/link";
import { AddCardFlow } from "@/components/AddCardFlow";
import { isClaudeConfigured } from "@/lib/identify/claude";

export const dynamic = "force-dynamic";

export default function AddPage() {
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
      <AddCardFlow claudeConfigured={isClaudeConfigured()} />
    </div>
  );
}
