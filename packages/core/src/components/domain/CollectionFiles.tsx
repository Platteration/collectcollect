"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api-client";
import { when } from "../../format";
import type { CollectionStatus, RebuildResult } from "../../domain/markdown/mirror";
import type { CollectionImport } from "../../domain/markdown/restore";

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The plain-text copy and the full backup: where they are, whether they are
 * keeping up, and what you can do with them.
 */
export function CollectionFiles({ status, noun, backup }: { status: CollectionStatus; noun: { singular: string; plural: string }; backup: { photos: number; databaseBytes: number; photoBytes: number } }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"rebuild" | "import" | "restore" | null>(null);
  const [rebuilt, setRebuilt] = useState<RebuildResult | null>(null);
  const [imported, setImported] = useState<CollectionImport | null>(null);
  const [restored, setRestored] = useState<{ items: number; photos: number; movedAsideTo: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const behind = status.enabled && status.items !== status.files;

  const rebuild = async () => {
    setBusy("rebuild");
    setError(null);
    try {
      setRebuilt((await api<{ result: RebuildResult }>("/api/collection/rebuild", { method: "POST" })).result);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const readBack = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("import");
    setError(null);
    const form = new FormData();
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".zip")) form.set("archive", file);
      else form.append("files", file);
    }
    try {
      setImported((await api<{ result: CollectionImport }>("/api/collection/import", { method: "POST", body: form })).result);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!archive) return;
    if (!confirm(`Replace the whole collection with ${archive.name}? What is here now is moved aside, not deleted.`)) return;
    setBusy("restore");
    setError(null);
    try {
      const form = new FormData();
      form.set("archive", archive);
      setRestored((await api<{ result: { items: number; photos: number; movedAsideTo: string } }>("/api/backup/restore", { method: "POST", body: form })).result);
      setArchive(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card-surface space-y-3 p-4">
        <h2 className="font-semibold">Backup</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          One zip holding a consistent copy of the database and every photo: {backup.photos} photo{backup.photos === 1 ? "" : "s"} ({mb(backup.photoBytes)}) plus a {mb(backup.databaseBytes)} database.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/backup" className="btn-secondary" download>
            Download backup
          </a>
          <input type="file" accept=".zip,application/zip" className="text-sm" onChange={(e) => setArchive(e.target.files?.[0] ?? null)} />
          <button type="button" className="btn-secondary" onClick={restore} disabled={!archive || busy !== null}>
            {busy === "restore" ? "Restoring…" : "Restore from a backup"}
          </button>
        </div>
        {restored && (
          <p className="text-sm">
            Restored {restored.items} {restored.items === 1 ? noun.singular : noun.plural} and {restored.photos} photo{restored.photos === 1 ? "" : "s"}. The previous collection was moved to <code className="font-mono text-xs">{restored.movedAsideTo}</code>.
          </p>
        )}
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="font-semibold">Your {noun.plural}, in plain text</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Every {noun.singular} is also a Markdown file, rewritten whenever it changes, so the collection outlives this app.
        </p>
        <dl className="grid gap-x-4 gap-y-1 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt style={{ color: "var(--muted)" }}>Folder</dt>
            <dd className="break-all font-mono text-xs">{status.dir}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt style={{ color: "var(--muted)" }}>Files</dt>
            <dd>
              {status.files} for {status.items} {status.items === 1 ? noun.singular : noun.plural} ({mb(status.bytes)})
              {behind && <span style={{ color: "var(--chart-bad-text)" }}> · out of step</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt style={{ color: "var(--muted)" }}>Last written</dt>
            <dd>{status.updatedAt ? when(status.updatedAt) : "never"}</dd>
          </div>
          {!status.enabled && (
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Writing</dt>
              <dd style={{ color: "var(--chart-bad-text)" }}>off (MARKDOWN_MIRROR=off)</dd>
            </div>
          )}
          {status.failures > 0 && (
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Failures</dt>
              <dd style={{ color: "var(--chart-bad-text)" }}>
                {status.failures} · {status.lastError}
              </dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/collection" className="btn-secondary" download>
            Download the Markdown
          </a>
          <a href="/api/export" className="btn-secondary" download>
            Export CSV
          </a>
          <a href="/api/export?type=sales" className="btn-secondary" download>
            Sales CSV
          </a>
          <button type="button" className="btn-secondary" onClick={rebuild} disabled={busy !== null || !status.enabled}>
            {busy === "rebuild" ? "Writing…" : "Rewrite the files"}
          </button>
          <label className="btn-secondary cursor-pointer">
            {busy === "import" ? "Reading…" : "Rebuild from files"}
            <input type="file" className="sr-only" multiple accept=".md,.zip" disabled={busy !== null} onChange={(e) => readBack(e.target.files)} />
          </label>
        </div>
        {rebuilt && (
          <p className="text-sm">
            Wrote {rebuilt.written} file{rebuilt.written === 1 ? "" : "s"}.
            {rebuilt.orphans > 0 && <> {rebuilt.orphans} file{rebuilt.orphans === 1 ? "" : "s"} in that folder describe {noun.plural} this app does not have. They were left exactly as they were — read them back in if they are yours.</>}
          </p>
        )}
        {imported && (
          <div className="space-y-1 text-sm">
            <p>
              {imported.created} added, {imported.replaced} replaced, {imported.acquisitions} purchases, {imported.sales} sales and {imported.prices} recorded values came back.
            </p>
            {imported.warnings.length > 0 && (
              <ul className="list-inside list-disc" style={{ color: "var(--muted)" }}>
                {imported.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>
                    {w.file}: {w.message}
                  </li>
                ))}
              </ul>
            )}
            {imported.skipped.length > 0 && (
              <ul className="list-inside list-disc" style={{ color: "var(--chart-bad-text)" }}>
                {imported.skipped.slice(0, 10).map((s, i) => (
                  <li key={i}>
                    {s.file}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
