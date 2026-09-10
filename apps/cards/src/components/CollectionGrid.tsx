"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { CardTile } from "./CardTile";
import { GRADING_STATUSES, type CardRecord, type GradingStatus, type PriceSummary, type Submission } from "@/lib/types";

export interface GridCard {
  card: CardRecord;
  price: PriceSummary | null;
}

/**
 * The collection grid with multi-select. Acting on a handful of cards at once
 * is the difference between a chore and a click, so refresh, plan, submission
 * and delete all work over a selection.
 */
export function CollectionGrid({
  cards,
  drafts,
  locations,
}: {
  cards: GridCard[];
  drafts: Array<Pick<Submission, "id" | "name" | "company">>;
  locations: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ids = [...selected];

  /** Run an action over the selection one card at a time, reporting progress. */
  const runAll = async (label: string, fn: (id: number) => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    let done = 0;
    const failures: string[] = [];
    for (const id of ids) {
      setProgress(`${label} ${++done} of ${ids.length}…`);
      try {
        await fn(id);
      } catch (e) {
        failures.push((e as Error).message);
      }
    }
    setBusy(false);
    setProgress(failures.length ? `${done - failures.length} of ${done} succeeded.` : `${label} ${done} card${done === 1 ? "" : "s"}.`);
    if (failures.length) setError(failures[0]);
    setSelected(new Set());
    router.refresh();
  };

  const remove = async () => {
    if (!confirm(`Delete ${ids.length} card${ids.length === 1 ? "" : "s"} from your collection? This cannot be undone.`)) return;
    await runAll("Deleted", (id) => api(`/api/cards/${id}`, { method: "DELETE" }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={selected.size > 0 && selected.size === cards.length}
            ref={(el) => {
              if (el) el.indeterminate = selected.size > 0 && selected.size < cards.length;
            }}
            onChange={(e) => setSelected(e.target.checked ? new Set(cards.map((c) => c.card.id)) : new Set())}
          />
          {selected.size > 0 ? `${selected.size} selected` : "Select all"}
        </label>

        {selected.size > 0 && (
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => runAll("Refreshed", (id) => api(`/api/cards/${id}/price`, { method: "POST" }))}>
              Refresh prices
            </button>
            <select
              className="input max-w-[12rem]"
              aria-label="Set grading plan"
              disabled={busy}
              defaultValue=""
              onChange={(e) => {
                const value = e.target.value as GradingStatus;
                e.target.value = "";
                if (value) void runAll("Updated", (id) => api(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify({ gradingStatus: value }) }));
              }}
            >
              <option value="">Set grading plan…</option>
              {(Object.keys(GRADING_STATUSES) as GradingStatus[]).map((k) => (
                <option key={k} value={k}>
                  {GRADING_STATUSES[k]}
                </option>
              ))}
            </select>
            {drafts.length > 0 && (
              <select
                className="input max-w-[14rem]"
                aria-label="Add to submission"
                disabled={busy}
                defaultValue=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  e.target.value = "";
                  if (id) void runAll("Added", (cardId) => api(`/api/submissions/${id}`, { method: "PATCH", body: JSON.stringify({ addCardId: cardId }) }));
                }}
              >
                <option value="">Add to submission…</option>
                {drafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.company})
                  </option>
                ))}
              </select>
            )}
            <span className="flex items-center gap-1">
              <input
                className="input max-w-[12rem]"
                aria-label="Kept in"
                placeholder="Kept in…"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                list="known-locations"
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || !location.trim()}
                onClick={() => {
                  const value = location.trim();
                  setLocation("");
                  void runAll("Filed", (id) => api(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify({ location: value }) }));
                }}
              >
                File
              </button>
            </span>
            <button type="button" className="btn-danger" disabled={busy} onClick={remove}>
              Delete
            </button>
          </>
        )}

        {progress && <span className="text-sm text-neutral-500">{progress}</span>}
      </div>

      {locations.length > 0 && (
        <datalist id="known-locations">
          {locations.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      )}

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map(({ card, price }) => (
          <div key={card.id} className="relative">
            <label
              className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md shadow-sm"
              style={{ background: "color-mix(in srgb, var(--background) 85%, transparent)" }}
            >
              <span className="sr-only">Select {card.name}</span>
              <input type="checkbox" className="h-4 w-4" checked={selected.has(card.id)} onChange={() => toggle(card.id)} />
            </label>
            <CardTile card={card} price={price} selected={selected.has(card.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
