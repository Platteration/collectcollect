"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReplacedCollection, RestoreResult } from "@/lib/backup";

/**
 * The collections a restore moved aside, and a way back to each.
 *
 * A restore never deletes what it replaces, and this is where that promise is
 * kept: putting one back is the same swap run the other way, so it is itself
 * undoable, and nothing here needs a terminal.
 */
export function ReplacedCollections({ replaced }: { replaced: ReplacedCollection[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (replaced.length === 0) return null;

  const restore = async (entry: ReplacedCollection) => {
    const what = entry.cards === null ? "that collection" : `${entry.cards} card${entry.cards === 1 ? "" : "s"}`;
    if (!confirm(`Put back ${what} from ${new Date(entry.replacedAt).toLocaleString()}? The collection you have now is moved aside in its turn, so this can be undone too.`)) return;
    setBusy(entry.name);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/backup/replaced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: entry.name }),
      });
      const json = (await res.json()) as { result?: RestoreResult; error?: string };
      if (!res.ok || !json.result) throw new Error(json.error ?? `Could not put it back (${res.status})`);
      setResult(json.result);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
      <h3 className="text-sm font-medium">Replaced by a restore</h3>
      <p className="mt-1 text-sm text-neutral-500">
        Each restore moves the collection it replaces into a dated folder inside the data directory. Any of them can be
        put back.
      </p>
      <ul className="mt-2 divide-y divide-black/5 dark:divide-white/5">
        {replaced.map((entry) => (
          <li key={entry.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div>
              <div>{new Date(entry.replacedAt).toLocaleString()}</div>
              <div className="text-xs text-neutral-500">
                {entry.cards === null ? "database unreadable" : `${entry.cards} card${entry.cards === 1 ? "" : "s"}`}, {entry.photos} photo
                {entry.photos === 1 ? "" : "s"} · <span className="font-mono">{entry.name}</span>
              </div>
            </div>
            <button type="button" className="btn-secondary" onClick={() => restore(entry)} disabled={busy !== null || entry.cards === null}>
              {busy === entry.name ? "Putting back…" : "Put it back"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="mt-2 text-sm text-green-800 dark:text-green-300">
          Put back {result.cards} card{result.cards === 1 ? "" : "s"} and {result.photos} photo{result.photos === 1 ? "" : "s"}. The
          collection that was live is now in {result.movedAsideTo}.
        </p>
      )}
    </div>
  );
}
