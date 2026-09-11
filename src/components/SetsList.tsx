"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { when } from "@/lib/format";
import type { SetProgress } from "@/lib/sets";
import { GAMES, label } from "@/lib/types";

export function SetsList({ sets }: { sets: SetProgress[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = async (set: SetProgress) => {
    setBusy(set.key);
    setErrors((e) => ({ ...e, [set.key]: "" }));
    try {
      await api("/api/sets/refresh", { method: "POST", body: JSON.stringify({ game: set.game, setName: set.setName }) });
      router.refresh();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [set.key]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  if (sets.length === 0) {
    return <div className="card-surface p-8 text-center text-sm text-neutral-500">No sets yet. Add some cards with a set name and they will appear here.</div>;
  }

  return (
    <ul className="space-y-2">
      {sets.map((set) => {
        const percent = set.total ? Math.round((((set.total ?? 0) - (set.missing ?? 0)) / set.total) * 100) : null;
        return (
          <li key={set.key} className="card-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/sets/${set.game}/${encodeURIComponent(set.setName)}`}
                  className="font-display text-lg font-semibold hover:underline"
                >
                  {set.setName}
                </Link>
                <div className="text-xs text-neutral-500">
                  {label(GAMES, set.game)} · you have {set.owned} card{set.owned === 1 ? "" : "s"}
                  {set.copies !== set.owned ? ` (${set.copies} copies)` : ""}
                  {set.fetchedAt ? ` · checklist from ${when(set.fetchedAt)}` : ""}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {percent !== null ? (
                  <div className="text-right">
                    <div className="hero-figure text-xl">{percent}%</div>
                    <div className="text-xs text-neutral-500">
                      {(set.total ?? 0) - (set.missing ?? 0)} of {set.total} · {set.missing} missing
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-neutral-500">{set.supported ? "No checklist yet" : "No checklist source for this game"}</span>
                )}
                {set.supported && (
                  <button type="button" className="btn-secondary" onClick={() => refresh(set)} disabled={busy === set.key}>
                    {busy === set.key ? "Fetching…" : set.total ? "Refresh" : "Fetch checklist"}
                  </button>
                )}
              </div>
            </div>

            {percent !== null && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div className="h-full rounded-full bg-[var(--chart-series-3)]" style={{ width: `${percent}%` }} />
              </div>
            )}
            {errors[set.key] && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{errors[set.key]}</p>}
          </li>
        );
      })}
    </ul>
  );
}
