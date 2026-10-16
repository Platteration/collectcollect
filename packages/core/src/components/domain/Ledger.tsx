"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api-client";
import { money } from "../../format";
import type { Acquisition } from "../../domain/acquisitions";
import type { Sale } from "../../domain/spec";

/**
 * What this item cost, and what it earned. Purchases and sales share a panel
 * because they are one ledger read from two ends: a sale takes copies out of
 * the oldest purchase still holding any, and undoing one puts them back.
 */
export function Ledger({ itemId, held, unique, acquisitions, sales }: { itemId: number; held: number; unique: boolean; acquisitions: Acquisition[]; sales: Sale[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState<"purchase" | "sale" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setAdding(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Money</h2>
        <div className="flex flex-wrap gap-2">
          {!unique && (
            <button type="button" className="btn-secondary" onClick={() => setAdding("purchase")} disabled={busy}>
              Bought more
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setAdding("sale")} disabled={busy || held < 1}>
            {held < 1 ? "All sold" : "Sold"}
          </button>
        </div>
      </div>

      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}

      {adding === "purchase" && (
        <PurchaseForm busy={busy} onCancel={() => setAdding(null)} onSubmit={(body) => run(() => api(`/api/items/${itemId}/acquisitions`, { method: "POST", body: JSON.stringify(body) }))} />
      )}
      {adding === "sale" && (
        <SaleForm held={held} unique={unique} busy={busy} onCancel={() => setAdding(null)} onSubmit={(body) => run(() => api(`/api/items/${itemId}/sales`, { method: "POST", body: JSON.stringify(body) }))} />
      )}

      {acquisitions.length > 0 && (
        <div>
          <h3 className="label">Purchases</h3>
          <div className="card-surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  {["Acquired", "Copies", "Left", "Cost each", "From", ""].map((h, i) => (
                    <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {acquisitions.map((lot) => (
                  <tr key={lot.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="whitespace-nowrap px-3 py-2">{lot.acquiredAt.slice(0, 10)}</td>
                    <td className="px-3 py-2">{lot.quantity}</td>
                    <td className="px-3 py-2">{lot.remaining}</td>
                    <td className="whitespace-nowrap px-3 py-2">{lot.unitCost === null ? <span style={{ color: "var(--muted)" }}>not recorded</span> : money(lot.unitCost)}</td>
                    <td className="px-3 py-2" style={{ color: "var(--muted)" }}>
                      {lot.source ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {lot.remaining === lot.quantity ? (
                        <button type="button" className="text-xs underline" style={{ color: "var(--muted)" }} disabled={busy} onClick={() => run(() => api(`/api/items/${itemId}/acquisitions/${lot.id}`, { method: "DELETE" }))}>
                          Undo
                        </button>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--muted)" }} title="Copies from this purchase have been sold">
                          sold from
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sales.length > 0 && (
        <div>
          <h3 className="label">Sales</h3>
          <div className="card-surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  {["Sold", "Copies", "Each", "Fees", "Cost each", "Gain", "Where", ""].map((h, i) => (
                    <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => {
                  const gain = sale.unitCost === null ? null : Math.round((sale.unitPrice * sale.quantity - sale.fees - sale.unitCost * sale.quantity) * 100) / 100;
                  return (
                    <tr key={sale.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="whitespace-nowrap px-3 py-2">{sale.soldAt.slice(0, 10)}</td>
                      <td className="px-3 py-2">{sale.quantity}</td>
                      <td className="whitespace-nowrap px-3 py-2">{money(sale.unitPrice)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{money(sale.fees)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{sale.unitCost === null ? <span style={{ color: "var(--muted)" }}>not recorded</span> : money(sale.unitCost)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{gain === null ? <span style={{ color: "var(--muted)" }}>—</span> : <span className={gain >= 0 ? "delta-up" : "delta-down"}>{money(gain)}</span>}</td>
                      <td className="px-3 py-2" style={{ color: "var(--muted)" }}>
                        {sale.venue ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" className="text-xs underline" style={{ color: "var(--muted)" }} disabled={busy} onClick={() => run(() => api(`/api/sales/${sale.id}`, { method: "DELETE" }))}>
                          Undo
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function PurchaseForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (body: { quantity: number; unitCost: number | null; acquiredAt?: string; source?: string }) => void }) {
  const [quantity, setQuantity] = useState("1");
  const [cost, setCost] = useState("");
  const [at, setAt] = useState("");
  const [source, setSource] = useState("");
  return (
    <form
      className="card-surface grid gap-3 p-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ quantity: Math.max(1, Number(quantity) || 1), unitCost: cost.trim() === "" ? null : Number(cost), acquiredAt: at ? `${at}T12:00:00` : undefined, source: source.trim() || undefined });
      }}
    >
      <label className="block">
        <span className="label">How many</span>
        <input className="input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Cost each</span>
        <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="blank if unknown" />
      </label>
      <label className="block">
        <span className="label">When</span>
        <input className="input" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Where from</span>
        <input className="input" value={source} onChange={(e) => setSource(e.target.value)} />
      </label>
      <div className="flex gap-2 sm:col-span-4">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Record the purchase"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SaleForm({ held, unique, busy, onCancel, onSubmit }: { held: number; unique: boolean; busy: boolean; onCancel: () => void; onSubmit: (body: { quantity: number; unitPrice: number; fees: number; soldAt?: string; venue?: string }) => void }) {
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("");
  const [at, setAt] = useState("");
  const [venue, setVenue] = useState("");
  return (
    <form
      className="card-surface grid gap-3 p-4 sm:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          quantity: unique ? 1 : Math.min(held, Math.max(1, Number(quantity) || 1)),
          // Deliberately not defaulted: an empty box reaching the server as zero would book a free sale.
          unitPrice: Number(price),
          fees: fees.trim() === "" ? 0 : Number(fees),
          soldAt: at ? `${at}T12:00:00` : undefined,
          venue: venue.trim() || undefined,
        });
      }}
    >
      {!unique && (
        <label className="block">
          <span className="label">How many</span>
          <input className="input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
            {held} held
          </span>
        </label>
      )}
      <label className="block">
        <span className="label">Sold for, each</span>
        <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
      </label>
      <label className="block">
        <span className="label">Fees</span>
        <input className="input" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">When</span>
        <input className="input" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">Where</span>
        <input className="input" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="eBay, auction, private" />
      </label>
      <div className="flex gap-2 sm:col-span-5">
        <button type="submit" className="btn-primary" disabled={busy || price.trim() === ""}>
          {busy ? "Saving…" : "Record the sale"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="text-xs sm:col-span-5" style={{ color: "var(--muted)" }}>
        The copies sold come out of the oldest purchase still holding any, so the gain is measured against what those particular copies cost.
      </p>
    </form>
  );
}
