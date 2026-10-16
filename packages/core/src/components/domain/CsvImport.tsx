"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api-client";
import { money } from "../../format";

interface Row {
  line: number;
  input: Record<string, unknown> | null;
  problem: string | null;
  warning: string | null;
}
interface Preview {
  mapping: Record<string, string>;
  unmapped: string[];
  rows: Row[];
  total: number;
  usable: number;
}
interface Result {
  created: number;
  merged: number;
  skipped: Array<{ line: number; reason: string }>;
}

/**
 * Bringing in a spreadsheet: read first, apply second. The preview shows
 * which columns were understood, which were ignored, and every row that
 * could not be read and why.
 */
export function CsvImport({ titleField, noun, example }: { titleField: string; noun: { singular: string; plural: string }; example: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (apply: boolean) => {
    setBusy(apply ? "apply" : "preview");
    setError(null);
    try {
      const body = await api<{ preview: Preview; result?: Result }>("/api/import", { method: "POST", body: JSON.stringify({ csv, apply }) });
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
        <label className="block">
          <span className="label">A CSV file</span>
          <input
            className="input"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setCsv(await file.text());
              setPreview(null);
              setResult(null);
            }}
          />
        </label>
      </div>
      <label className="block">
        <span className="label">Or paste it</span>
        <textarea
          className="input font-mono text-xs"
          rows={6}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
            setResult(null);
          }}
          placeholder={example}
        />
        <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
          One row per {noun.singular}. Columns are matched by name; only the {titleField} column has to be there.
        </span>
      </label>
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
          {!result && preview.rows.length > 0 && (
            <div className="card-surface max-h-72 overflow-auto p-2">
              <table className="w-full text-xs">
                <thead className="text-left uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  <tr>
                    <th className="py-1 pr-3">Line</th>
                    <th className="py-1 pr-3">{noun.singular}</th>
                    <th className="py-1 pr-3 text-right">Qty</th>
                    <th className="py-1 text-right">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 200).map((row) => (
                    <tr key={row.line} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="py-1 pr-3" style={{ color: "var(--muted)" }}>
                        {row.line}
                      </td>
                      {row.input ? (
                        <>
                          <td className="py-1 pr-3">
                            {String(row.input[titleField] ?? "")}
                            {row.warning && <div style={{ color: "var(--chart-bad-text)" }}>{row.warning}</div>}
                          </td>
                          <td className="py-1 pr-3 text-right tabular-nums">{String(row.input.quantity ?? 1)}</td>
                          <td className="py-1 text-right tabular-nums">{row.input.purchasePrice === null || row.input.purchasePrice === undefined ? "—" : money(Number(row.input.purchasePrice))}</td>
                        </>
                      ) : (
                        <td colSpan={3} className="py-1" style={{ color: "var(--chart-bad-text)" }}>
                          {row.problem}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!result && problems.length > 0 && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {problems.length} row{problems.length === 1 ? "" : "s"} cannot be imported and {warnings.length} had something assumed; both are marked above.
            </p>
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
            <strong>{result.created}</strong> added, <strong>{result.merged}</strong> joined something already held, {result.skipped.length} skipped.
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
          <Link href="/collection" className="btn-primary inline-flex">
            View {noun.plural}
          </Link>
        </div>
      )}
    </section>
  );
}
