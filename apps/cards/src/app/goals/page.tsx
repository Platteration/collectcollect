import Link from "next/link";
import { Goals } from "@/components/Goals";
import { listGoals } from "@/lib/goals";
export const dynamic = "force-dynamic";
export default function GoalsPage() {
  return <div className="space-y-5"><div><h1 className="font-display text-3xl font-semibold">Collecting goals</h1><p className="text-sm text-neutral-500">Plan what to collect next, set a budget, and follow your progress. <Link className="underline" href="/sets">Explore set checklists</Link>.</p></div><Goals goals={listGoals()} /></div>;
}
