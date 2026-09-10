"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api-client";
import { money, when } from "../../format";
import type { PriceSummaryBase } from "../../domain/spec";

interface Props {
  itemId: number;
  summary: (PriceSummaryBase & Record<string, unknown>) | null;
  manualValue: number | null;
  manualPrices: Record<string, number>;
  /** Keys the owner may type a price under, e.g. grades; empty for a single value. */
  manualKeys: string[];
  /** Whether any source beyond the owner is configured, so the refresh button says what it will do. */
  hasSources: boolean;
  /** Named prices to show from the latest summary, e.g. graded or completeness prices. */
  named?: Array<{ label: string; value: number; estimated?: boolean }>;
}

/**
 * Pricing one item: ask the sources again, say what it is worth yourself, or
 * enter a value at a date so the chart has a history to draw.
 */
export function PricePanel({ itemId, summary, manualValue, manualPrices, manualKeys, hasSources, named = [] }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"refresh" | "manual" | "history" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "manual" | "history">("idle");
  const [value, setValue] = useState(manualValue === null ? "" : String(manualValue));
  const [keyed, setKeyed] = useState<Record<string, string>>(Object.fromEntries(manualKeys.map((k) => [k, manualPrices[k] === undefined ? "" : String(manualPrices[k])])));
  const [entry, setEntry] = useState({ value: "", at: new Date().toISOString().slice(0, 10), note: "" });

  const refresh = async () => {
    setBusy("refresh");
    setError(null);
    setNote(null);
    try {
      const body = await api<{ summary: PriceSummaryBase; stored: boolean }>(`/api/items/${itemId}/price`, { method: "POST" });
      setNote(body.stored ? `Priced ${when(body.summary.fetchedAt)}.` : "No source had a price, so the last recorded value was left as it was.");
      if (body.summary.errors.length) setError(body.summary.errors.map((e) => `${e.source}: ${e.message}`).join(" · "));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveManual = async (clear = false) => {
    setBusy("manual");
    setError(null);
    try {
      const prices: Record<string, number> = {};
      if (!clear) for (const [k, v] of Object.entries(keyed)) if (v.trim() !== "") prices[k] = Number(v);
      await api(`/api/items/${itemId}/price`, {
        method: "PUT",
        body: JSON.stringify({ manualValue: clear || value.trim() === "" ? null : Number(value), manualPrices: prices }),
      });
      setMode("idle");
      if (clear) {
        setValue("");
        setKeyed(Object.fromEntries(manualKeys.map((k) => [k, ""])));
      }
      // Re-price so the change shows in the history, not only on the next refresh.
      await api(`/api/items/${itemId}/price`, { method: "POST" }).catch(() => undefined);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveEntry = async () => {
    setBusy("history");
    setError(null);
    try {
      await api(`/api/items/${itemId}/prices`, { method: "POST", body: JSON.stringify(entry) });
      setMode("idle");
      setEntry({ value: "", at: new Date().toISOString().slice(0, 10), note: "" });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const hasManual = manualValue !== null || Object.keys(manualPrices).length > 0;

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="label mb-0">Price</span>
        {summary && (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {when(summary.fetchedAt)}
          </span>
        )}
      </div>

      {named.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
          {named.map((n) => (
            <div key={n.label} className={`rounded-md border px-2 py-1.5 ${n.estimated ? "border-dashed" : ""}`} style={{ borderColor: "var(--line)" }} title={n.estimated ? "Estimated from a multiplier in Settings" : undefined}>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {n.label}
                {n.estimated && <span className="ml-1 badge bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">est.</span>}
              </div>
              <div className="font-medium">{money(n.value)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={refresh} disabled={busy !== null}>
          {busy === "refresh" ? "Asking…" : hasSources ? "Refresh price" : "Record price"}
        </button>
        {mode === "idle" && (
          <>
            <button type="button" className="btn-secondary" onClick={() => setMode("manual")} disabled={busy !== null}>
              {hasManual ? "Change your price" : "Set your own price"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setMode("history")} disabled={busy !== null}>
              Add a past value
            </button>
            {hasManual && (
              <button type="button" className="btn-secondary" onClick={() => saveManual(true)} disabled={busy !== null}>
                Use the sources again
              </button>
            )}
          </>
        )}
      </div>

      {mode === "manual" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="label">Your price, each</span>
              <input className="input max-w-40" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </label>
            {manualKeys.map((k) => (
              <label key={k} className="block">
                <span className="label">{k}</span>
                <input className="input max-w-32" inputMode="decimal" value={keyed[k] ?? ""} onChange={(e) => setKeyed({ ...keyed, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => saveManual(false)} disabled={busy !== null}>
              {busy === "manual" ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setMode("idle")} disabled={busy !== null}>
              Cancel
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            A price you type in overrides every source on this item until you clear it.
          </p>
        </div>
      )}

      {mode === "history" && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="label">Value</span>
              <input className="input" inputMode="decimal" value={entry.value} onChange={(e) => setEntry({ ...entry, value: e.target.value })} autoFocus />
            </label>
            <label className="block">
              <span className="label">On</span>
              <input className="input" type="date" value={entry.at} onChange={(e) => setEntry({ ...entry, at: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Where from</span>
              <input className="input" value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} placeholder="auction result, appraisal, receipt" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={saveEntry} disabled={busy !== null || entry.value.trim() === ""}>
              {busy === "history" ? "Saving…" : "Add to the history"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setMode("idle")} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {hasManual && mode === "idle" && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Valued by your own price{manualValue !== null ? ` of ${money(manualValue)}` : ""}. Sources are still asked and recorded; they are just not the answer.
        </p>
      )}

      {summary && summary.quotes.length > 0 && (
        <ul className="divide-y text-sm" style={{ borderColor: "var(--line)" }}>
          {summary.quotes.map((q, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
              <div className="min-w-0">
                <div className="font-medium">
                  {q.url ? (
                    <a href={q.url} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                      {q.sourceLabel}
                    </a>
                  ) : (
                    q.sourceLabel
                  )}
                </div>
                <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
                  {q.matchedName}
                  {q.matchedDetail ? ` · ${q.matchedDetail}` : ""}
                </div>
                {Object.keys(q.prices).length > 0 && (
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {Object.entries(q.prices)
                      .map(([k, v]) => `${k} ${money(v, q.currency)}`)
                      .join(" · ")}
                  </div>
                )}
              </div>
              <div className="font-medium">{q.price !== null ? money(q.price, q.currency) : "—"}</div>
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {note}
        </p>
      )}
      {error && (
        <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
