"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import type { ImportPreview, ImportResult } from "@/lib/import";
import { CATEGORIES, CATEGORY_IDS, type Category } from "@/lib/types";

/**
 * Bringing in a spreadsheet.
 *
 * Reading first, applying second: the preview shows which of the file's columns
 * were understood, which were ignored, and every row that could not be read and
 * why. A file that half-imports without saying which half is worse than one
 * that does not import at all.
 */
export function CsvImport() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
    setPreview(null);
    setResult(null);
  };

  const run = async (apply: boolean) => {
    setBusy(apply ? "apply" : "preview");
    setError(null);
    try {
      const body = await api<{ preview: ImportPreview; result?: ImportResult }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ csv, category: category || undefined, apply }),
      });
      setPreview(body.preview);
      if (body.result) {
        setResult(body.result);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const problems = preview?.rows.filter((r) => r.problem) ?? [];
  const warnings = preview?.rows.filter((r) => r.warning) ?? [];

  return (
    <section className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="csv-file">
            A CSV file
          </label>
          <input
            id="csv-file"
            className="input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => readFile(e.target.files?.[0])}
          />
        </div>
        <div>
          <label className="label" htmlFor="fallback-category">
            Kind, for rows that do not say
          </label>
          <select id="fallback-category" className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            <option value="">Read it from each name</option>
            {CATEGORY_IDS.map((id) => (
              <option key={id} value={id}>
                {CATEGORIES[id]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="csv-text">
          Or paste it
        </label>
        <textarea
          id="csv-text"
          className="input font-mono text-xs"
          rows={6}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
            setResult(null);
          }}
          placeholder={"name,float,cost\nAK-47 | Redline (Field-Tested),0.2213,42"}
        />
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          One row per item. The name is the only column that has to be there —
          the kind, the gun, the finish and the wear tier are all read out of it.
        </p>
      </div>

      <button type="button" className="btn-secondary" onClick={() => run(false)} disabled={!csv.trim() || busy !== null}>
        {busy === "preview" ? "Reading…" : "See what it says"}
      </button>

      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{preview.usable}</strong> of {preview.total} row{preview.total === 1 ? "" : "s"} can be read.
          </p>

          <dl className="card-surface grid gap-x-4 gap-y-1 p-3 text-xs sm:grid-cols-2">
            {Object.entries(preview.mapping).map(([field, header]) => (
              <div key={field} className="flex justify-between gap-2">
                <dt style={{ color: "var(--muted)" }}>{header}</dt>
                <dd>{field}</dd>
              </div>
            ))}
          </dl>

          {preview.unmapped.length > 0 && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Ignored, because nothing here matches them: {preview.unmapped.join(", ")}.
            </p>
          )}

          {/* Once it has run, what happened supersedes what was going to
              happen: showing both lists the same skipped rows twice. */}
          {!result && warnings.length > 0 && (
            <details className="card-surface p-3 text-xs">
              <summary className="cursor-pointer">{warnings.length} row(s) with something assumed</summary>
              <ul className="mt-2 list-inside list-disc" style={{ color: "var(--muted)" }}>
                {warnings.slice(0, 20).map((r) => (
                  <li key={r.line}>
                    Line {r.line}: {r.warning}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!result && problems.length > 0 && (
            <details className="card-surface p-3 text-xs" open>
              <summary className="cursor-pointer">{problems.length} row(s) that cannot be imported</summary>
              <ul className="mt-2 list-inside list-disc" style={{ color: "var(--muted)" }}>
                {problems.slice(0, 20).map((r) => (
                  <li key={r.line}>
                    Line {r.line}: {r.problem}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {preview.usable > 0 && !result && (
            <button type="button" className="btn-primary" onClick={() => run(true)} disabled={busy !== null}>
              {busy === "apply" ? "Importing…" : `Import ${preview.usable} row${preview.usable === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="card-surface space-y-2 p-4 text-sm">
          <p>
            <strong>{result.created}</strong> added, <strong>{result.merged}</strong> joined something already held,{" "}
            <strong>{result.updated}</strong> already known.
          </p>
          {result.skipped.length > 0 && (
            <ul className="list-inside list-disc" style={{ color: "var(--muted)" }}>
              {result.skipped.slice(0, 20).map((s) => (
                <li key={s.line}>
                  Line {s.line}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
