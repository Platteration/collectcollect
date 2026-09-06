"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import type { CardRecord, Identification, PriceSummary } from "@/lib/types";
import { CardForm, emptyForm, formToInput, type CardFormState } from "./CardForm";
import { PricePanel } from "./PricePanel";

type Status = "uploading" | "identifying" | "review" | "saving" | "saved" | "error";

interface Item {
  key: string;
  uploads: string[];
  previews: string[];
  status: Status;
  error: string | null;
  identification: Identification | null;
  form: CardFormState;
  price: PriceSummary | null;
  pricing: boolean;
  savedId: number | null;
  hint: string;
}

let counter = 0;
const nextKey = () => `item-${Date.now()}-${counter++}`;

function formFromIdentification(id: Identification): CardFormState {
  return {
    ...emptyForm(id.game),
    name: id.name,
    sport: id.sport ?? "",
    setName: id.set_name ?? "",
    setCode: id.set_code ?? "",
    cardNumber: id.card_number ?? "",
    year: id.year ? String(id.year) : "",
    rarity: id.rarity ?? "",
    variant: id.variant ?? "",
    language: id.language ?? "",
    manufacturer: id.manufacturer ?? "",
    gradingCompany: id.grading.company ?? "",
    grade: id.grading.grade ?? "",
    certNumber: id.grading.cert_number ?? "",
    notes: id.condition_notes ? `Condition notes: ${id.condition_notes}` : "",
  };
}

export function AddCardFlow({ claudeConfigured }: { claudeConfigured: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const patch = useCallback((key: string, p: Partial<Item> | ((it: Item) => Partial<Item>)) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...(typeof p === "function" ? p(it) : p) } : it)));
  }, []);

  const identify = useCallback(
    async (key: string, uploads: string[], hint: string) => {
      patch(key, { status: "identifying", error: null });
      try {
        const { identification } = await api<{ identification: Identification }>("/api/identify", {
          method: "POST",
          body: JSON.stringify({ uploads, hint: hint || undefined }),
        });
        patch(key, { status: "review", identification, form: formFromIdentification(identification), price: null });
      } catch (e) {
        patch(key, { status: "review", error: `Identification failed: ${(e as Error).message}. Fill in the details by hand.` });
      }
    },
    [patch],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return;
      const fresh: Item[] = images.map((f) => ({
        key: nextKey(),
        uploads: [],
        previews: [URL.createObjectURL(f)],
        status: "uploading",
        error: null,
        identification: null,
        form: emptyForm(),
        price: null,
        pricing: false,
        savedId: null,
        hint: "",
      }));
      setItems((prev) => [...fresh, ...prev]);
      await Promise.all(
        fresh.map(async (item, i) => {
          const fd = new FormData();
          fd.append("files", images[i]);
          try {
            const { uploads } = await api<{ uploads: { name: string }[] }>("/api/uploads", { method: "POST", body: fd });
            const names = uploads.map((u) => u.name);
            patch(item.key, { uploads: names, previews: names.map((n) => `/api/uploads/${n}`) });
            if (claudeConfigured) await identify(item.key, names, "");
            else patch(item.key, { status: "review", error: "Claude is not configured, so enter the details by hand." });
          } catch (e) {
            patch(item.key, { status: "error", error: (e as Error).message });
          }
        }),
      );
    },
    [claudeConfigured, identify, patch],
  );

  const addManual = () => {
    setItems((prev) => [
      {
        key: nextKey(),
        uploads: [],
        previews: [],
        status: "review",
        error: null,
        identification: null,
        form: emptyForm(),
        price: null,
        pricing: false,
        savedId: null,
        hint: "",
      },
      ...prev,
    ]);
  };

  const addExtraPhoto = async (key: string, file: File) => {
    const fd = new FormData();
    fd.append("files", file);
    try {
      const { uploads } = await api<{ uploads: { name: string }[] }>("/api/uploads", { method: "POST", body: fd });
      const names = uploads.map((u) => u.name);
      patch(key, (it) => ({ uploads: [...it.uploads, ...names], previews: [...it.previews, ...names.map((n) => `/api/uploads/${n}`)] }));
    } catch (e) {
      patch(key, { error: (e as Error).message });
    }
  };

  const lookupPrices = async (item: Item) => {
    patch(item.key, { pricing: true, error: null });
    try {
      const input = formToInput(item.form);
      const { summary } = await api<{ summary: PriceSummary }>("/api/prices/lookup", {
        method: "POST",
        body: JSON.stringify({ ...input, externalIds: {} }),
      });
      patch(item.key, { price: summary, pricing: false });
    } catch (e) {
      patch(item.key, { pricing: false, error: (e as Error).message });
    }
  };

  const save = async (item: Item) => {
    patch(item.key, { status: "saving", error: null });
    try {
      const input = formToInput(item.form);
      if (!input.name) throw new Error("Card name is required");
      const { card } = await api<{ card: CardRecord }>("/api/cards", {
        method: "POST",
        body: JSON.stringify({ ...input, imagePath: item.uploads[0] ?? null, identification: item.identification }),
      });
      // Store a first price snapshot so the collection view has a value right away.
      api(`/api/cards/${card.id}/price`, { method: "POST" }).catch(() => undefined);
      patch(item.key, { status: "saved", savedId: card.id });
    } catch (e) {
      patch(item.key, { status: "review", error: (e as Error).message });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`card-surface flex flex-col items-center gap-3 border-2 border-dashed p-8 text-center transition ${
          dragging ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30" : "border-black/15 dark:border-white/15"
        }`}
      >
        <p className="text-lg font-medium">Drop card photos here</p>
        <p className="max-w-lg text-sm text-neutral-500">
          One photo per card. Each photo is identified automatically; you review the details, look up prices, and
          save. Add a back or slab-label photo to a card afterwards if the front alone is ambiguous.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="btn-primary" onClick={() => fileInput.current?.click()}>
            Choose photos
          </button>
          <button type="button" className="btn-secondary" onClick={addManual}>
            Enter a card manually
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        {!claudeConfigured && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            ANTHROPIC_API_KEY is not set, so photos will not be identified automatically. You can still add cards by
            hand and look up prices.
          </p>
        )}
      </div>

      {items.map((item) => (
        <ItemCard
          key={item.key}
          item={item}
          onChange={(form) => patch(item.key, { form, price: null })}
          onHint={(hint) => patch(item.key, { hint })}
          onReidentify={() => identify(item.key, item.uploads, item.hint)}
          onExtraPhoto={(f) => addExtraPhoto(item.key, f)}
          onLookup={() => lookupPrices(item)}
          onSave={() => save(item)}
          onRemove={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
        />
      ))}
    </div>
  );
}

function ItemCard({
  item,
  onChange,
  onHint,
  onReidentify,
  onExtraPhoto,
  onLookup,
  onSave,
  onRemove,
}: {
  item: Item;
  onChange: (f: CardFormState) => void;
  onHint: (h: string) => void;
  onReidentify: () => void;
  onExtraPhoto: (f: File) => void;
  onLookup: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const extraInput = useRef<HTMLInputElement>(null);
  const busy = item.status === "uploading" || item.status === "identifying" || item.status === "saving";
  const id = item.identification;

  return (
    <div className="card-surface p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          {item.previews.length ? (
            item.previews.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="w-full rounded-lg bg-neutral-100 object-contain dark:bg-neutral-800" />
            ))
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center rounded-lg bg-neutral-100 text-sm text-neutral-400 dark:bg-neutral-800">
              No photo
            </div>
          )}
          {item.uploads.length > 0 && item.uploads.length < 4 && item.status !== "saved" && (
            <>
              <button type="button" className="btn-secondary w-full" onClick={() => extraInput.current?.click()} disabled={busy}>
                + Add back / label photo
              </button>
              <input
                ref={extraInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onExtraPhoto(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status={item.status} />
            {item.status !== "saved" && (
              <button type="button" className="text-xs text-neutral-500 underline" onClick={onRemove}>
                Remove
              </button>
            )}
          </div>

          {item.error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{item.error}</div>
          )}

          {item.status === "saved" && item.savedId && (
            <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950/40 dark:text-green-200">
              Saved <strong>{item.form.name}</strong> to your collection.{" "}
              <Link href={`/cards/${item.savedId}`} className="underline">
                Open card
              </Link>
            </div>
          )}

          {id && item.status !== "saved" && (
            <div className="rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Identified as {id.name}</span>
                <span className={`badge ${id.confidence >= 0.8 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : id.confidence >= 0.5 ? "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100" : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"}`}>
                  {Math.round(id.confidence * 100)}% confident
                </span>
              </div>
              {id.alternatives.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs text-neutral-500">Could also be:</div>
                  {id.alternatives.map((alt, i) => (
                    <button
                      key={i}
                      type="button"
                      className="block text-left text-xs underline decoration-dotted"
                      onClick={() =>
                        onChange({ ...item.form, name: alt.name, setName: alt.set_name ?? item.form.setName, cardNumber: alt.card_number ?? item.form.cardNumber })
                      }
                    >
                      {alt.name}
                      {alt.set_name ? ` · ${alt.set_name}` : ""}
                      {alt.card_number ? ` · #${alt.card_number}` : ""} — {alt.reason}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {item.uploads.length > 0 && item.status !== "saved" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input max-w-sm"
                placeholder="Hint for re-identification (e.g. 'Japanese', 'it's the 1999 Topps')"
                value={item.hint}
                onChange={(e) => onHint(e.target.value)}
              />
              <button type="button" className="btn-secondary" onClick={onReidentify} disabled={busy}>
                Re-identify
              </button>
            </div>
          )}

          {item.status !== "saved" && item.status !== "uploading" && item.status !== "identifying" && (
            <>
              <CardForm value={item.form} onChange={onChange} disabled={busy} />
              <PricePanel summary={item.price} loading={item.pricing} onRefresh={onLookup} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-primary" onClick={onSave} disabled={busy || !item.form.name.trim()}>
                  {item.status === "saving" ? "Saving…" : "Save to collection"}
                </button>
              </div>
            </>
          )}
          {(item.status === "uploading" || item.status === "identifying") && (
            <div className="flex items-center gap-2 py-6 text-sm text-neutral-500">
              <span className="h-3 w-3 animate-pulse rounded-full bg-amber-500" />
              {item.status === "uploading" ? "Uploading photo…" : "Reading the card…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, [string, string]> = {
    uploading: ["Uploading", "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100"],
    identifying: ["Identifying", "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"],
    review: ["Review", "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100"],
    saving: ["Saving", "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100"],
    saved: ["Saved", "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100"],
    error: ["Error", "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100"],
  };
  const [label, cls] = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
