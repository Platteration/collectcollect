"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CollectionImport } from "@/lib/markdown/restore";

interface Props {
  enabled: boolean;
}

/** Rebuild the plain-text copy, or read a collection back out of one. */
export function CollectionFiles({ enabled }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"rebuild" | "import" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebuilt, setRebuilt] = useState<{ written: number; orphans: number } | null>(null);
  const [imported, setImported] = useState<CollectionImport | null>(null);

  const rebuild = async () => {
    setBusy("rebuild");
    setError(null);
    setImported(null);
    try {
      const res = await fetch("/api/collection/rebuild", { method: "POST" });
      const json = (await res.json()) as { result?: { written: number; orphans: number }; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Could not write the files (${res.status})`);
      setRebuilt(json.result!);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!file) return;
    if (!confirm(`Read ${file.name} back into the collection? Cards whose files match one you already have are replaced by what the file says.`)) return;
    setBusy("import");
    setError(null);
    setRebuilt(null);
    try {
      const body = new FormData();
      if (file.name.toLowerCase().endsWith(".zip")) body.append("archive", file);
      else body.append("files", file);
      const res = await fetch("/api/collection/import", { method: "POST", body });
      const json = (await res.json()) as { result?: CollectionImport; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`);
      setImported(json.result!);
      setFile(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href="/api/collection" className="btn-secondary" download>
          Download the Markdown
        </a>
        <button type="button" className="btn-secondary" onClick={rebuild} disabled={!enabled || busy !== null}>
          {busy === "rebuild" ? "Writing…" : "Rewrite the files"}
        </button>
      </div>

      <div className="border-t border-black/10 pt-3 dark:border-white/10">
        <h3 className="text-sm font-medium">Rebuild from these files</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Point this at a folder of card files (as a zip) or a single <code>.md</code> file. Cards are matched on the id
          inside each file, so doing it twice changes nothing the second time.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="block">
            <span className="sr-only">Markdown files</span>
            <input
              id="collection-files"
              type="file"
              accept=".zip,.md,text/markdown,application/zip"
              className="text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button type="button" className="btn-secondary" onClick={restore} disabled={!file || busy !== null}>
            {busy === "import" ? "Reading…" : "Read them back in"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {rebuilt && (
        <p className="text-sm text-green-800 dark:text-green-300">
          Wrote {rebuilt.written} file{rebuilt.written === 1 ? "" : "s"}.
          {rebuilt.orphans > 0
            ? ` ${rebuilt.orphans} other file${rebuilt.orphans === 1 ? " describes a card" : "s describe cards"} that ${rebuilt.orphans === 1 ? "is" : "are"} not in your collection; ${rebuilt.orphans === 1 ? "it was" : "they were"} left alone. Read them back in to recover them.`
            : ""}
        </p>
      )}
      {imported && (
        <div className="text-sm text-green-800 dark:text-green-300">
          <p>
            Added {imported.created} card{imported.created === 1 ? "" : "s"} and refreshed {imported.replaced}, with{" "}
            {imported.prices} recorded price{imported.prices === 1 ? "" : "s"} and {imported.sales} sale
            {imported.sales === 1 ? "" : "s"}.
          </p>
          {imported.skipped.length > 0 && (
            <p className="mt-1 text-amber-700 dark:text-amber-300">
              Skipped {imported.skipped.length}: {imported.skipped.slice(0, 3).map((s) => `${s.file} (${s.reason})`).join("; ")}
            </p>
          )}
          {imported.warnings.length > 0 && (
            <p className="mt-1 text-amber-700 dark:text-amber-300">
              {imported.warnings.length} line{imported.warnings.length === 1 ? "" : "s"} could not be read:{" "}
              {imported.warnings.slice(0, 2).map((w) => `${w.file} — ${w.message}`).join("; ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
