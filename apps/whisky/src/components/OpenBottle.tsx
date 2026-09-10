"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";

/**
 * Opening a bottle. One copy leaves the sealed stack (or the only copy is
 * opened in place), its value is frozen at today's, and it stops counting
 * towards the portfolio. This is not a thing to do by accident, so it asks.
 */
export function OpenBottle({ itemId, quantity }: { itemId: number; quantity: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const { item } = await api<{ item: { id: number } }>(`/api/items/${itemId}/open`, { method: "POST", body: JSON.stringify({}) });
      router.push(`/items/${item.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="card-surface flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="text-sm">
        <p className="font-medium">Open {quantity > 1 ? "one of these" : "this bottle"}?</p>
        <p style={{ color: "var(--muted)" }}>
          {quantity > 1 ? "One copy leaves the stack and becomes its own bottle. " : ""}
          Its value is frozen at today&rsquo;s, it stops counting towards the portfolio, and it stays here for drinking.
        </p>
        {error && (
          <p style={{ color: "var(--chart-bad-text)" }}>{error}</p>
        )}
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={open} disabled={busy}>
            {busy ? "Opening…" : "Yes, open it"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
            Keep it sealed
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
          Open a bottle
        </button>
      )}
    </section>
  );
}
