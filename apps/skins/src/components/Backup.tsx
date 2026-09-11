"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import { when } from "@collectcollect/core/format";
import type { ReplacedCollection, RestoreResult } from "@/lib/backup";

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * One archive out, one archive back in, and the way back from either.
 *
 * A restore never deletes what it replaces, and the list at the bottom is
 * where that promise is kept: putting one back is the same swap run the other
 * way, so it is itself undoable, and nothing here needs a terminal.
 */
export function Backup({ summary, replaced }: { summary: { items: number; databaseBytes: number }; replaced: ReplacedCollection[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ verb: string; result: RestoreResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (verb: string, key: string, work: () => Promise<RestoreResult>) => {
    setBusy(key);
    setError(null);
    setResult(null);
    try {
      setResult({ verb, result: await work() });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = () => {
    if (!file) return;
    if (!confirm(`Replace your whole inventory with ${file.name}? The current one is moved aside, not deleted, so this can be undone from here.`)) return;
    const body = new FormData();
    body.append("archive", file);
    void run("Restored", "restore", async () => {
      const json = await api<{ result: RestoreResult }>("/api/backup/restore", { method: "POST", body });
      setFile(null);
      if (input.current) input.current.value = "";
      return json.result;
    });
  };

  const putBack = (entry: ReplacedCollection) => {
    const what = entry.items === null ? "that inventory" : `${entry.items} item${entry.items === 1 ? "" : "s"}`;
    if (!confirm(`Put back ${what} from ${when(entry.replacedAt)}? The inventory you have now is moved aside in its turn, so this can be undone too.`)) return;
    void run("Put back", entry.name, async () => {
      const json = await api<{ result: RestoreResult }>("/api/backup/replaced", {
        method: "POST",
        body: JSON.stringify({ name: entry.name }),
      });
      return json.result;
    });
  };

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Backup</h2>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        One zip holding a consistent copy of the database — {summary.items} item{summary.items === 1 ? "" : "s"},{" "}
        {mb(summary.databaseBytes)} — and the plain-text copy beside it. Images are Steam links, so there is nothing
        else to carry.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a href="/api/backup" className="btn-secondary" download>
          Download backup
        </a>
      </div>

      <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <h3 className="label">Restore</h3>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Put a backup back. Everything currently here is moved into a dated folder inside the data directory first,
          so a restore of the wrong file can be undone below.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="block">
            <span className="sr-only">Backup archive</span>
            <input
              ref={input}
              id="restore-archive"
              type="file"
              accept=".zip,application/zip"
              className="text-sm"
              disabled={busy !== null}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="button" className="btn-danger" onClick={restore} disabled={!file || busy !== null}>
            {busy === "restore" ? "Restoring…" : "Restore from backup"}
          </button>
        </div>
      </div>

      {replaced.length > 0 && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          <h3 className="label">Replaced by a restore</h3>
          <ul className="card-surface divide-y text-sm" style={{ borderColor: "var(--line)" }}>
            {replaced.map((entry) => (
              <li key={entry.name} className="flex flex-wrap items-center justify-between gap-2 p-3" style={{ borderColor: "var(--line)" }}>
                <div>
                  <div>{when(entry.replacedAt)}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {entry.items === null ? "database unreadable" : `${entry.items} item${entry.items === 1 ? "" : "s"}`} ·{" "}
                    <span className="font-mono">{entry.name}</span>
                  </div>
                </div>
                <button type="button" className="btn-secondary" onClick={() => putBack(entry)} disabled={busy !== null || entry.items === null}>
                  {busy === entry.name ? "Putting back…" : "Put it back"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }} role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="card-surface p-3 text-sm">
          {result.verb} {result.result.items} item{result.result.items === 1 ? "" : "s"}. The inventory that was live is now in{" "}
          <span className="font-mono text-xs break-all">{result.result.movedAsideTo}</span>.
        </p>
      )}
    </section>
  );
}
