"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RestoreResult } from "@/lib/backup";

export function RestoreForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    if (!file) return;
    if (!confirm(`Replace your whole collection with ${file.name}? The current one is moved aside, not deleted, so this can be undone by hand.`)) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("archive", file);
      const res = await fetch("/api/backup/restore", { method: "POST", body });
      const json = (await res.json()) as { result?: RestoreResult; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Restore failed (${res.status})`);
      setResult(json.result!);
      setFile(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
      <h3 className="text-sm font-medium">Restore</h3>
      <p className="mt-1 text-sm text-neutral-500">
        Put a backup back. Everything currently here is moved into a dated folder inside the data directory first, so a
        restore of the wrong file can be undone by hand.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="block">
          <span className="sr-only">Backup archive</span>
          <input id="restore-archive" type="file" accept=".zip,application/zip" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button type="button" className="btn-danger" onClick={restore} disabled={!file || busy}>
          {busy ? "Restoring…" : "Restore from backup"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {result && (
        <p className="mt-2 text-sm text-green-800 dark:text-green-300">
          Restored {result.cards} card{result.cards === 1 ? "" : "s"} and {result.photos} photo
          {result.photos === 1 ? "" : "s"}. The collection that was replaced is in {result.movedAsideTo}.
        </p>
      )}
    </div>
  );
}
