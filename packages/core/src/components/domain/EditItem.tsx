"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api-client";
import type { FieldSpec } from "../../domain/spec";
import { ItemForm, formFromItem, formToInput, type ItemFormValue } from "./ItemForm";

interface Props {
  fields: FieldSpec[];
  item: Record<string, unknown> & { id: number; quantity: number; purchasePrice: number | null; location: string | null; notes: string | null };
  unique: boolean;
  noun: string;
  locations: string[];
}

/**
 * Correcting a record, and removing one. Folded away by default: a page that
 * opens with an edit form invites changing things that did not need changing.
 * Deleting takes the whole history with it, so it asks first and says so.
 */
export function EditItem({ fields, item, unique, noun, locations }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ItemFormValue>(() => formFromItem(fields, item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify(formToInput(fields, form)) });
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
      router.push("/collection");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          setForm(formFromItem(fields, item));
          setOpen(true);
        }}
      >
        Edit
      </button>
    );
  }

  return (
    <section className="card-surface space-y-4 p-4">
      <form onSubmit={save} className="space-y-4">
        <ItemForm fields={fields} value={form} onChange={setForm} disabled={busy} unique={unique} locations={locations} idPrefix="edit" />
        {!unique && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Changing the quantity reconciles the purchases: more copies than they account for become a purchase of unknown cost, and fewer come off the newest one.
          </p>
        )}
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
            <p className="text-sm">This removes the {noun} and everything recorded about it: every purchase, every sale, and every value ever taken. There is no undo.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" style={{ border: "1px solid var(--chart-bad)", color: "var(--chart-bad-text)" }} onClick={remove} disabled={busy}>
                {busy ? "Removing…" : "Yes, remove it"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="text-sm underline" style={{ color: "var(--muted)" }} onClick={() => setConfirming(true)} disabled={busy}>
            Remove this {noun}
          </button>
        )}
      </div>
    </section>
  );
}
