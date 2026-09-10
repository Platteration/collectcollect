"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import {
  CATEGORIES,
  CATEGORY_IDS,
  EXTERIORS,
  EXTERIOR_IDS,
  RARITIES,
  RARITY_IDS,
  exteriorForFloat,
  hasWear,
  type Category,
  type Exterior,
  type ItemInput,
  type ItemRecord,
  type Rarity,
} from "@/lib/types";

/**
 * Correcting an item, and removing one.
 *
 * Folded away by default: most of what is here came from Steam or from a
 * spreadsheet and is right, and a page that opens with an edit form invites
 * changing things that did not need changing.
 *
 * Deleting takes the item's whole history with it — every purchase, every sale,
 * every recorded price — so it asks first and says exactly that. Nothing else
 * in this app destroys a record.
 */
export function EditItem({ item, storageUnits }: { item: ItemRecord; storageUnits: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [form, setForm] = useState({
    marketHashName: item.marketHashName,
    category: item.category,
    rarity: item.rarity ?? "",
    exterior: item.exterior ?? "",
    floatValue: item.floatValue === null ? "" : String(item.floatValue),
    paintSeed: item.paintSeed === null ? "" : String(item.paintSeed),
    collection: item.collection ?? "",
    nameTag: item.nameTag ?? "",
    quantity: String(item.quantity),
    purchasePrice: item.purchasePrice === null ? "" : String(item.purchasePrice),
    storageUnit: item.storageUnit ?? "",
    tradableAfter: item.tradableAfter ? item.tradableAfter.slice(0, 10) : "",
    notes: item.notes ?? "",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const wearable = hasWear(form.category as Category);
  const floatValue = form.floatValue.trim() === "" ? null : Number(form.floatValue);
  const floatUsable = floatValue !== null && Number.isFinite(floatValue) && floatValue >= 0 && floatValue <= 1;
  const effectiveExterior = floatUsable ? exteriorForFloat(floatValue) : ((form.exterior || null) as Exterior | null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const patch: Partial<ItemInput> = {
      marketHashName: form.marketHashName.trim(),
      category: form.category,
      rarity: (form.rarity || null) as Rarity | null,
      exterior: effectiveExterior,
      floatValue: floatUsable ? floatValue : null,
      paintSeed: form.paintSeed.trim() === "" ? null : Number(form.paintSeed),
      collection: form.collection.trim() || null,
      nameTag: form.nameTag.trim() || null,
      quantity: Math.max(0, Number(form.quantity) || 0),
      purchasePrice: form.purchasePrice.trim() === "" ? null : Number(form.purchasePrice),
      storageUnit: form.storageUnit.trim() || null,
      tradableAfter: form.tradableAfter || null,
      notes: form.notes.trim() || null,
    };
    try {
      await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/items/${item.id}`, { method: "DELETE" });
      router.push("/inventory");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
          Edit
        </button>
      </div>
    );
  }

  return (
    <section className="card-surface space-y-4 p-4">
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="edit-name">
            Market hash name
          </label>
          <input id="edit-name" className="input" value={form.marketHashName} onChange={(e) => set({ marketHashName: e.target.value })} required />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="edit-category">
              Kind
            </label>
            <select id="edit-category" className="input" value={form.category} onChange={(e) => set({ category: e.target.value as Category })}>
              {CATEGORY_IDS.map((id) => (
                <option key={id} value={id}>
                  {CATEGORIES[id]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="edit-rarity">
              Rarity
            </label>
            <select id="edit-rarity" className="input" value={form.rarity} onChange={(e) => set({ rarity: e.target.value as Rarity })}>
              <option value="">Not recorded</option>
              {RARITY_IDS.map((id) => (
                <option key={id} value={id}>
                  {RARITIES[id].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="edit-collection">
              Collection
            </label>
            <input id="edit-collection" className="input" value={form.collection} onChange={(e) => set({ collection: e.target.value })} />
          </div>

          {wearable && (
            <>
              <div>
                <label className="label" htmlFor="edit-float">
                  Float
                </label>
                <input id="edit-float" className="input" inputMode="decimal" value={form.floatValue} onChange={(e) => set({ floatValue: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="edit-exterior">
                  Wear tier
                </label>
                <select
                  id="edit-exterior"
                  className="input"
                  value={effectiveExterior ?? ""}
                  onChange={(e) => set({ exterior: e.target.value as Exterior })}
                  disabled={floatUsable}
                >
                  <option value="">Not recorded</option>
                  {EXTERIOR_IDS.map((id) => (
                    <option key={id} value={id}>
                      {EXTERIORS[id]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="edit-seed">
                  Pattern seed
                </label>
                <input id="edit-seed" className="input" inputMode="numeric" value={form.paintSeed} onChange={(e) => set({ paintSeed: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="edit-name-tag">
                  Name tag
                </label>
                <input id="edit-name-tag" className="input" value={form.nameTag} onChange={(e) => set({ nameTag: e.target.value })} />
              </div>
            </>
          )}

          {item.stackable && (
            <div>
              <label className="label" htmlFor="edit-quantity">
                How many
              </label>
              <input id="edit-quantity" className="input" inputMode="numeric" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                Changing this reconciles the purchases: more copies than they
                account for become a purchase of unknown cost, and fewer come
                off the newest one.
              </p>
            </div>
          )}

          <div>
            <label className="label" htmlFor="edit-price">
              Paid, each
            </label>
            <input id="edit-price" className="input" inputMode="decimal" value={form.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="edit-storage">
              Kept in
            </label>
            <input
              id="edit-storage"
              className="input"
              list="edit-storage-units"
              value={form.storageUnit}
              onChange={(e) => set({ storageUnit: e.target.value })}
            />
            <datalist id="edit-storage-units">
              {storageUnits.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="edit-lock">
              Trade locked until
            </label>
            <input id="edit-lock" className="input" type="date" value={form.tradableAfter} onChange={(e) => set({ tradableAfter: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="edit-notes">
            Notes
          </label>
          <textarea id="edit-notes" className="input" rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>

      <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
        {confirming ? (
          <div className="space-y-2">
            <p className="text-sm">
              This removes the item and everything recorded about it: every
              purchase, every sale, and every price ever taken. There is no
              undo.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                style={{ border: "1px solid var(--chart-bad)", color: "var(--chart-bad-text)" }}
                onClick={remove}
                disabled={busy}
              >
                {busy ? "Removing…" : "Yes, remove it"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="text-sm underline"
            style={{ color: "var(--muted)" }}
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            Remove this item
          </button>
        )}
      </div>
    </section>
  );
}
