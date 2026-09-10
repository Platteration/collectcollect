"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import { when } from "@collectcollect/core/format";
import type { CollectionStatus, RebuildResult } from "@/lib/markdown/mirror";
import type { CollectionImport } from "@/lib/markdown/restore";

/**
 * The plain-text copy: where it is, whether it is keeping up, and the two
 * things you can do to it.
 *
 * Rewriting deliberately leaves behind any file describing an item this
 * database does not have, and says how many it left. The likeliest way that
 * happens is someone pointing a fresh install at the folder that is the only
 * copy of their records, and a rewrite must never be the thing that destroys
 * it.
 */
export function CollectionFiles({ status }: { status: CollectionStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"rebuild" | "import" | null>(null);
  const [rebuilt, setRebuilt] = useState<RebuildResult | null>(null);
  const [imported, setImported] = useState<CollectionImport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const behind = status.items !== status.files;

  const rebuild = async () => {
    setBusy("rebuild");
    setError(null);
    try {
      const body = await api<{ result: RebuildResult }>("/api/collection/rebuild", { method: "POST" });
      setRebuilt(body.result);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("import");
    setError(null);
    const form = new FormData();
    for (const file of files) {
      if (file.name.toLowerCase().endsWith(".zip")) form.set("archive", file);
      else form.append("files", file);
    }
    try {
      const body = await api<{ result: CollectionImport }>("/api/collection/import", { method: "POST", body: form });
      setImported(body.result);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Your inventory, in plain text</h2>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Every item is also a Markdown file, rewritten whenever it changes. The
        items themselves live in Steam&rsquo;s database; what you paid for them
        is the part you can actually keep.
      </p>

      <dl className="card-surface grid gap-x-4 gap-y-1 p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt style={{ color: "var(--muted)" }}>Folder</dt>
          <dd className="font-mono text-xs break-all">{status.dir}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt style={{ color: "var(--muted)" }}>Files</dt>
          <dd>
            {status.files} for {status.items} item{status.items === 1 ? "" : "s"}
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

      <div className="flex flex-wrap items-center gap-3">
        <a href="/api/collection" className="btn-secondary" download>
          Download them
        </a>
        <a href="/api/export" className="btn-secondary" download>
          As a spreadsheet
        </a>
        <a href="/api/export?type=sales" className="btn-secondary" download>
          Sales as a spreadsheet
        </a>
        <button type="button" className="btn-secondary" onClick={rebuild} disabled={busy !== null || !status.enabled}>
          {busy === "rebuild" ? "Writing…" : "Rewrite the files"}
        </button>
        <label className="btn-secondary cursor-pointer">
          {busy === "import" ? "Reading…" : "Rebuild from files"}
          <input
            type="file"
            className="sr-only"
            multiple
            accept=".md,.zip"
            disabled={busy !== null}
            onChange={(e) => restore(e.target.files)}
          />
        </label>
      </div>

      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        The spreadsheet uses the column names the importer recognises, so an
        export is also a starting point for filling in what you paid — and
        reads straight back in.
      </p>

      {rebuilt && (
        <p className="card-surface p-3 text-sm">
          Wrote {rebuilt.written} file{rebuilt.written === 1 ? "" : "s"}.
          {rebuilt.orphans > 0 && (
            <>
              {" "}
              {rebuilt.orphans} file{rebuilt.orphans === 1 ? "" : "s"} in that folder describe items this app does not
              have. They were left exactly as they were — read them back in if they are yours.
            </>
          )}
        </p>
      )}

      {imported && (
        <div className="card-surface space-y-2 p-3 text-sm">
          <p>
            {imported.created} added, {imported.replaced} replaced, {imported.acquisitions} purchases, {imported.sales}{" "}
            sales and {imported.prices} recorded prices came back.
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
  );
}
