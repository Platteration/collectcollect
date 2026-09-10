"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import type { SteamImportResult } from "@/app/api/steam/import/route";
import { CATEGORIES, type ItemInput } from "@/lib/types";
import { isSteamId64 } from "@/lib/steam/inventory";

/**
 * Bringing in a whole Steam inventory.
 *
 * Two steps on purpose: reading is free and writing is not, so the preview
 * shows exactly what would arrive before anything is written. The wording is
 * careful about what an import is — a statement of what you hold now, not a
 * pile of new purchases — because that is what makes running it twice safe.
 */
export function SteamImport() {
  const router = useRouter();
  const [steamId, setSteamId] = useState("");
  const [preview, setPreview] = useState<ItemInput[] | null>(null);
  const [unmatched, setUnmatched] = useState(0);
  const [result, setResult] = useState<SteamImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valid = isSteamId64(steamId);

  const run = async (apply: boolean) => {
    setBusy(apply ? "apply" : "preview");
    setError(null);
    try {
      if (apply) {
        const body = await api<{ result: SteamImportResult }>("/api/steam/import", {
          method: "POST",
          body: JSON.stringify({ steamId }),
        });
        setResult(body.result);
        setPreview(null);
        router.refresh();
      } else {
        const body = await api<{ preview: ItemInput[]; unmatched: number }>("/api/steam/import", {
          method: "POST",
          body: JSON.stringify({ steamId, preview: true }),
        });
        setPreview(body.preview);
        setUnmatched(body.unmatched);
        setResult(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <label className="label" htmlFor="steam-id">
          SteamID64
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="steam-id"
            className="input max-w-xs"
            value={steamId}
            onChange={(e) => setSteamId(e.target.value)}
            placeholder="76561198000000001"
            inputMode="numeric"
          />
          <button type="button" className="btn-secondary" onClick={() => run(false)} disabled={!valid || busy !== null}>
            {busy === "preview" ? "Reading…" : "See what is there"}
          </button>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Seventeen digits, starting 7656119. The inventory has to be set to
          Public for Steam to show it to anyone, including this app.
        </p>
      </div>

      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{preview.length}</strong> item{preview.length === 1 ? "" : "s"} found
            {unmatched > 0 && `, and ${unmatched} Steam described too little to read`}.
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            This is what you hold now, so importing it sets the counts rather
            than adding to them — run it as often as you like. Nothing arrives
            with a price: Steam knows what you own, not what you paid, and a
            made-up price would make everything look like a break-even.
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Floats and pattern seeds are not in Steam&rsquo;s answer either.
            They stay blank rather than showing a zero, which would read as a
            pristine Factory New.
          </p>
          <div className="card-surface max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: "var(--surface)", color: "var(--muted)" }}>
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">Item</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">Kind</th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide">How many</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((item, i) => (
                  <tr key={`${item.marketHashName}-${i}`} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="px-3 py-1.5">{item.marketHashName}</td>
                    <td className="px-3 py-1.5" style={{ color: "var(--muted)" }}>
                      {CATEGORIES[item.category ?? "other"]}
                    </td>
                    <td className="px-3 py-1.5 text-right">{item.quantity ?? 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn-primary" onClick={() => run(true)} disabled={busy !== null}>
            {busy === "apply" ? "Importing…" : `Import ${preview.length} item${preview.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {result && (
        <div className="card-surface space-y-2 p-4 text-sm">
          <p>
            <strong>{result.created}</strong> added, <strong>{result.updated}</strong> already known,{" "}
            <strong>{result.increased}</strong> gone up, <strong>{result.decreased}</strong> gone down,{" "}
            <strong>{result.unchanged}</strong> unchanged.
          </p>
          {result.unmatched > 0 && (
            <p style={{ color: "var(--muted)" }}>
              {result.unmatched} asset{result.unmatched === 1 ? "" : "s"} came with no description, so nothing could be
              read from {result.unmatched === 1 ? "it" : "them"}.
            </p>
          )}
          {result.missing.length > 0 && (
            <div>
              <p>
                {result.missing.length} item{result.missing.length === 1 ? "" : "s"} you hold here were not in that
                inventory. Nothing was removed — they may be in a storage unit, which Steam does not show, or gone.
              </p>
              <ul className="mt-1 list-inside list-disc" style={{ color: "var(--muted)" }}>
                {result.missing.slice(0, 10).map((item) => (
                  <li key={item.id}>{item.name}</li>
                ))}
              </ul>
            </div>
          )}
          {result.failed.length > 0 && (
            <div>
              <p style={{ color: "var(--chart-bad-text)" }}>{result.failed.length} could not be saved:</p>
              <ul className="mt-1 list-inside list-disc" style={{ color: "var(--muted)" }}>
                {result.failed.slice(0, 10).map((f) => (
                  <li key={f.name}>
                    {f.name} — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
