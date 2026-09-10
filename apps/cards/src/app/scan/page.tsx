import Link from "next/link";
import { ScanFlow } from "@/components/ScanFlow";
import { isClaudeConfigured } from "@/lib/identify/claude";

export const dynamic = "force-dynamic";

export default function ScanPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Scan mode</h1>
        <Link href="/add" className="text-sm underline decoration-dotted">
          Add one card at a time instead
        </Link>
      </div>
      <ScanFlow claudeConfigured={isClaudeConfigured()} />
    </div>
  );
}
