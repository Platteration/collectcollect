"use client";

import { useState } from "react";

interface Purchase {
  id: number; quantity: number; remaining: number; unitCost: number | null; acquiredAt: string; source: string | null; notes: string | null;
}
export interface PurchaseCorrection {
  unitCost: number | null; acquiredAt: string; source: string; notes: string;
  expected: Pick<Purchase, "unitCost" | "acquiredAt" | "source" | "notes" | "quantity" | "remaining">;
}
/** One form in both catalogs; the server also checks sold lots and stale edits. */
export function PurchaseEditor({ lot, onSave }: { lot: Purchase; onSave: (patch: PurchaseCorrection) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState(lot.unitCost === null ? "" : String(lot.unitCost));
  const [date, setDate] = useState(lot.acquiredAt.slice(0, 10));
  const [source, setSource] = useState(lot.source ?? "");
  const [notes, setNotes] = useState(lot.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frozen = lot.remaining !== lot.quantity;
  if (!open) return <button className="text-xs underline" type="button" onClick={() => setOpen(true)} aria-label={`Edit purchase ${lot.id}`}>Edit purchase</button>;
  return <form className="card-surface my-2 w-full min-w-0 space-y-2 p-3 text-left" aria-label="Correct purchase" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const unitCost = cost.trim() === "" ? null : Number(cost);
      if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) throw new Error("Enter a valid cost, or leave it blank if unknown.");
      const acquiredAt = date === lot.acquiredAt.slice(0, 10) ? lot.acquiredAt : new Date(date + "T00:00:00Z").toISOString();
      await onSave({ unitCost, acquiredAt, source, notes, expected: { unitCost: lot.unitCost, acquiredAt: lot.acquiredAt, source: lot.source, notes: lot.notes, quantity: lot.quantity, remaining: lot.remaining } });
      setOpen(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    <label className="block"><span className="label">Cost per copy (USD)</span><input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} disabled={frozen || busy} placeholder="Blank if unknown" /></label>
    <label className="block"><span className="label">Acquired</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={frozen || busy} required /></label>
    <label className="block"><span className="label">Source</span><input className="input" value={source} onChange={(e) => setSource(e.target.value)} maxLength={4000} disabled={busy} /></label>
    <label className="block"><span className="label">Purchase notes</span><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} disabled={busy} /></label>
    {frozen && <p className="text-xs">Copies from this purchase have been sold. Undo those sales before changing the cost or date.</p>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    <div className="flex gap-2"><button className="btn-primary" disabled={busy}>Save purchase</button><button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button></div>
  </form>;
}
