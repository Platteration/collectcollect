"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import type { ServiceEntry } from "@/lib/types";

/**
 * The service log: what was done to this watch and when. Each change is a
 * PATCH of the whole list, so the record on disk and the Markdown copy stay
 * one thing, and an entry can be taken back if it was typed on the wrong
 * watch.
 */
export function ServiceHistory({ itemId, entries }: { itemId: number; entries: ServiceEntry[] }) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: ServiceEntry[]) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ serviceHistory: next }) });
      setNotes("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Service history</h2>
      {entries.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No service recorded yet.
        </p>
      ) : (
        <ul className="card-surface divide-y" style={{ borderColor: "var(--line)" }}>
          {entries.map((e, i) => (
            <li key={`${e.date}-${i}`} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div>
                <span className="font-medium">{e.date}</span>
                <span className="ml-2">{e.notes}</span>
              </div>
              <button type="button" className="text-xs underline decoration-dotted" style={{ color: "var(--muted)" }} disabled={busy} onClick={() => save(entries.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="card-surface grid gap-2 p-3 sm:grid-cols-[10rem_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void save([...entries, { date, notes }]);
        }}
      >
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Service date" required />
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Full service at Omega, mainspring replaced" aria-label="What was done" required />
        <button type="submit" className="btn-secondary" disabled={busy || !notes.trim()}>
          {busy ? "Saving…" : "Add"}
        </button>
      </form>
      {error && (
        <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
