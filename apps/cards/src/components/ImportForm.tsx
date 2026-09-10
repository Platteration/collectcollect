"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { money } from "@/lib/format";
import { GAMES, GAME_IDS, type Game } from "@/lib/types";
import type { ImportPreview, ImportResult } from "@/lib/import";

export function ImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [game, setGame] = useState<Game | "">("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async (file: File) => {
    setError(null);
    setResult(null);
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    await load(text, game);
  };

  const load = async (text: string, chosen: Game | "") => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ preview: ImportPreview }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ csv: text, game: chosen || undefined }),
      });
      setPreview(res.preview);
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ result: ImportResult }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ csv, game: game || undefined, apply: true }),
      });
      setResult(res.result);
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card-surface flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="label">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void read(file);
              e.target.value = "";
            }}
          />
        </label>
        <label className="block">
          <span className="label">Game, if the file has no column for it</span>
          <select
            className="input max-w-[14rem]"
            value={game}
            onChange={(e) => {
              const next = e.target.value as Game | "";
              setGame(next);
              if (csv) void load(csv, next);
            }}
          >
            <option value="">Use the file’s own column</option>
            {GAME_IDS.map((g) => (
              <option key={g} value={g}>
                {GAMES[g]}
              </option>
            ))}
          </select>
        </label>
        {filename && <span className="text-sm text-neutral-500">{filename}</span>}
      </section>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

      {result && (
        <section className="card-surface p-4">
          <h2 className="font-semibold">Imported</h2>
          <p className="mt-1 text-sm">
            {result.created} card{result.created === 1 ? "" : "s"} added, {result.merged} merged into cards you already
            had, {result.skipped.length} skipped.
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-2 max-h-48 overflow-y-auto text-sm text-neutral-600 dark:text-neutral-300">
              {result.skipped.map((s) => (
                <li key={s.line}>
                  Line {s.line}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <Link href="/collection" className="btn-primary mt-3 inline-flex">
            View collection
          </Link>
        </section>
      )}

      {preview && (
        <section className="card-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              {preview.usable} of {preview.total} row{preview.total === 1 ? "" : "s"} ready
            </h2>
            <button type="button" className="btn-primary" onClick={apply} disabled={busy || preview.usable === 0}>
              {busy ? "Importing…" : `Import ${preview.usable} card${preview.usable === 1 ? "" : "s"}`}
            </button>
          </div>

          <p className="mt-2 text-sm text-neutral-500">
            Matched columns: {Object.entries(preview.mapping).map(([field, header]) => `${header} → ${field}`).join(", ") || "none"}.
            {preview.unmapped.length > 0 && ` Ignored: ${preview.unmapped.join(", ")}.`}
          </p>

          <div className="mt-3 max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-1 pr-3">Line</th>
                  <th className="py-1 pr-3">Card</th>
                  <th className="py-1 pr-3">Details</th>
                  <th className="py-1 pr-3">Copy</th>
                  <th className="py-1 pr-3 text-right">Qty</th>
                  <th className="py-1 text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((row) => (
                  <tr key={row.line} className="border-t border-black/5 dark:border-white/5">
                    <td className="py-1 pr-3 text-neutral-500">{row.line}</td>
                    {row.input ? (
                      <>
                        <td className="py-1 pr-3 font-medium">
                          {row.input.name}
                          {row.warning && <div className="text-xs font-normal text-amber-700 dark:text-amber-300">{row.warning}</div>}
                        </td>
                        <td className="py-1 pr-3 text-neutral-500">
                          {[GAMES[row.input.game], row.input.setName, row.input.cardNumber ? `#${row.input.cardNumber}` : null, row.input.year]
                            .filter(Boolean)
                            .join(" · ")}
                        </td>
                        <td className="py-1 pr-3">{row.input.grade ? `${row.input.gradingCompany ?? "Graded"} ${row.input.grade}` : `Raw · ${row.input.condition}`}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{row.input.quantity}</td>
                        <td className="py-1 text-right tabular-nums">{row.input.purchasePrice === null || row.input.purchasePrice === undefined ? "—" : money(row.input.purchasePrice)}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-1 text-amber-700 dark:text-amber-300">
                        {row.problem}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 200 && <p className="mt-2 text-xs text-neutral-500">Showing the first 200 rows; all {preview.rows.length} will be imported.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
