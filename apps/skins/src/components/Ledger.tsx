"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import { money } from "@collectcollect/core/format";
import type { Acquisition } from "@/lib/acquisitions";
import type { ItemRecord, Sale } from "@/lib/types";

/**
 * What this item cost, and what it earned.
 *
 * Purchases and sales share a panel because they are the same ledger read from
 * two ends: a sale takes copies out of the oldest purchase still holding any,
 * and undoing one puts them back where they came from. Splitting them across
 * the page would hide that.
 */
export function Ledger({ item, acquisitions, sales }: { item: ItemRecord; acquisitions: Acquisition[]; sales: Sale[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState<"purchase" | "sale" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const held = item.quantity;

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
          {item.stackable && (
            <button type="button" className="btn-secondary" onClick={() => setAdding("purchase")} disabled={busy}>
              Bought more
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => setAdding("sale")} disabled={busy || held < 1}>
            {held < 1 ? "All sold" : "Sold some"}
          </button>
        </div>
      </div>

      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}

      {adding === "purchase" && (
        <PurchaseForm
          busy={busy}
          onCancel={() => setAdding(null)}
          onSubmit={(body) => run(() => api(`/api/items/${item.id}/acquisitions`, { method: "POST", body: JSON.stringify(body) }))}
        />
      )}

      {adding === "sale" && (
        <SaleForm
          held={held}
          stackable={item.stackable}
          busy={busy}
          onCancel={() => setAdding(null)}
          onSubmit={(body) => run(() => api(`/api/items/${item.id}/sales`, { method: "POST", body: JSON.stringify(body) }))}
        />
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
                    <td className="whitespace-nowrap px-3 py-2">
                      {/* Not knowing what a copy cost is a different thing from
                          it being free, and the table has to keep them apart. */}
                      {lot.unitCost === null ? <span style={{ color: "var(--muted)" }}>not recorded</span> : money(lot.unitCost)}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--muted)" }}>
                      {lot.source ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {lot.remaining === lot.quantity ? (
                        <button
                          type="button"
                          className="text-xs underline"
                          style={{ color: "var(--muted)" }}
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(`Remove this purchase of ${lot.quantity} cop${lot.quantity === 1 ? "y" : "ies"}? The copies go with it.`)) return;
                            void run(() => api(`/api/items/${item.id}/acquisitions/${lot.id}`, { method: "DELETE" }));
                          }}
                        >
                          Undo
                        </button>
                      ) : (
                        // Copies out of this lot are part of a sale's cost
                        // basis. Removing it would rewrite money that has
                        // already changed hands.
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
                  const gain =
                    sale.unitCost === null
                      ? null
                      : Math.round((sale.unitPrice * sale.quantity - sale.fees - sale.unitCost * sale.quantity) * 100) / 100;
                  return (
                    <tr key={sale.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="whitespace-nowrap px-3 py-2">{sale.soldAt.slice(0, 10)}</td>
                      <td className="px-3 py-2">{sale.quantity}</td>
                      <td className="whitespace-nowrap px-3 py-2">{money(sale.unitPrice)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{money(sale.fees)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {sale.unitCost === null ? <span style={{ color: "var(--muted)" }}>not recorded</span> : money(sale.unitCost)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {gain === null ? (
                          <span style={{ color: "var(--muted)" }}>—</span>
                        ) : (
                          <span className={gain >= 0 ? "delta-up" : "delta-down"}>{money(gain)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--muted)" }}>
                        {sale.venue ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="text-xs underline"
                          style={{ color: "var(--muted)" }}
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(`Undo this sale of ${sale.quantity} cop${sale.quantity === 1 ? "y" : "ies"}? The copies come back to the purchases they were sold from.`)) return;
                            void run(() => api(`/api/sales/${sale.id}`, { method: "DELETE" }));
                          }}
                        >
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

function PurchaseForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: { quantity: number; unitCost: number | null; acquiredAt?: string; source?: string }) => void;
}) {
  const [quantity, setQuantity] = useState("1");
  const [cost, setCost] = useState("");
  const [at, setAt] = useState("");
  const [source, setSource] = useState("");

  return (
    <form
      className="card-surface grid gap-3 p-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          quantity: Math.max(1, Number(quantity) || 1),
          // Blank means nobody knows, which is not the same as free.
          unitCost: cost.trim() === "" ? null : Number(cost),
          acquiredAt: at || undefined,
          source: source.trim() || undefined,
        });
      }}
    >
      <div>
        <label className="label" htmlFor="buy-quantity">
          How many
        </label>
        <input id="buy-quantity" className="input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="buy-cost">
          Cost each
        </label>
        <input id="buy-cost" className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="blank if unknown" />
      </div>
      <div>
        <label className="label" htmlFor="buy-at">
          When
        </label>
        <input id="buy-at" className="input" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="buy-source">
          Where from
        </label>
        <input id="buy-source" className="input" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
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

function SaleForm({
  held,
  stackable,
  busy,
  onCancel,
  onSubmit,
}: {
  held: number;
  stackable: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: { quantity: number; unitPrice: number; fees: number; soldAt?: string; venue?: string }) => void;
}) {
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
          quantity: stackable ? Math.min(held, Math.max(1, Number(quantity) || 1)) : 1,
          // Deliberately not defaulted. An empty box reaching the server as
          // zero would book a free sale and take the copies with it.
          unitPrice: Number(price),
          fees: fees.trim() === "" ? 0 : Number(fees),
          soldAt: at || undefined,
          venue: venue.trim() || undefined,
        });
      }}
    >
      {stackable && (
        <div>
          <label className="label" htmlFor="sell-quantity">
            How many
          </label>
          <input id="sell-quantity" className="input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {held} held
          </p>
        </div>
      )}
      <div>
        <label className="label" htmlFor="sell-price">
          Sold for, each
        </label>
        <input id="sell-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="sell-fees">
          Fees
        </label>
        <input id="sell-fees" className="input" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="sell-at">
          When
        </label>
        <input id="sell-at" className="input" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="sell-venue">
          Where
        </label>
        <input id="sell-venue" className="input" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Skinport" />
      </div>
      <div className="flex gap-2 sm:col-span-5">
        <button type="submit" className="btn-primary" disabled={busy || price.trim() === ""}>
          {busy ? "Saving…" : "Record the sale"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="text-xs sm:col-span-5" style={{ color: "var(--muted)" }}>
        The copies sold come out of the oldest purchase still holding any, so the
        gain is measured against what those particular copies cost.
      </p>
    </form>
  );
}
