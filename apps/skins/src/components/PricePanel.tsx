"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import { money, when } from "@collectcollect/core/format";
import type { ItemRecord, PriceSummary } from "@/lib/types";

/**
 * Pricing one item: ask the markets again, or say what it is worth yourself.
 *
 * A refresh that found nothing says so and leaves the last recorded value
 * alone — it is not stored, so the history does not gain a hole where a market
 * happened to be quiet.
 */
export function PricePanel({ item, summary }: { item: ItemRecord; summary: PriceSummary | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"refresh" | "manual" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [manual, setManual] = useState(item.manualPrice === null ? "" : String(item.manualPrice));

  const refresh = async () => {
    setBusy("refresh");
    setError(null);
    setNote(null);
    try {
      const body = await api<{ summary: PriceSummary; stored: boolean }>(`/api/items/${item.id}/price`, { method: "POST" });
      setNote(
        body.stored
          ? `Priced ${when(body.summary.fetchedAt)}.`
          : "Nothing is listing one right now, so the last recorded price was left as it was.",
      );
      if (body.summary.errors.length) {
        setError(body.summary.errors.map((e) => `${e.source}: ${e.message}`).join(" · "));
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveManual = async (value: string | null) => {
    setBusy("manual");
    setError(null);
    setNote(null);
    try {
      await api(`/api/items/${item.id}/price`, {
        method: "PUT",
        body: JSON.stringify({ manualPrice: value === null || value.trim() === "" ? null : Number(value) }),
      });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

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

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={refresh} disabled={busy !== null}>
          {busy === "refresh" ? "Asking…" : "Ask the markets"}
        </button>
        {!editing && (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)} disabled={busy !== null}>
            {item.manualPrice === null ? "Set your own price" : "Change your price"}
          </button>
        )}
        {!editing && item.manualPrice !== null && (
          <button type="button" className="btn-secondary" onClick={() => saveManual(null)} disabled={busy !== null}>
            Use the market again
          </button>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="manual-price">
              Your price, each
            </label>
            <input
              id="manual-price"
              className="input max-w-40"
              inputMode="decimal"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              autoFocus
            />
          </div>
          <button type="button" className="btn-primary" onClick={() => saveManual(manual)} disabled={busy !== null}>
            {busy === "manual" ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={busy !== null}>
            Cancel
          </button>
        </div>
      )}

      {item.manualPrice !== null && !editing && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Valued at {money(item.manualPrice)} because you said so. The markets are still asked and recorded; they are
          just not the answer.
        </p>
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
