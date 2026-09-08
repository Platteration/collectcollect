import { setProgress } from "@/lib/sets";
import { SetsList } from "@/components/SetsList";

export const dynamic = "force-dynamic";

export default function SetsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Sets</h1>
        <p className="max-w-2xl text-sm text-neutral-500">
          Every set your collection touches. Fetch a set’s published checklist to see how close it is to complete and
          what is still missing. Pokémon, Magic and Yu-Gi-Oh! have checklist sources; sports cards do not.
        </p>
      </div>
      <SetsList sets={setProgress()} />
    </div>
  );
}
