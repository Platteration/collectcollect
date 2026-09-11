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
  accentColor: string | null;
  /** Existing cards that look like this one; shown before saving. */
  duplicates: CardRecord[] | null;
}

/** Map an estimated 10-point grade onto the raw condition scale the app stores. */
function conditionFromGrade(grade: string | null | undefined): string {
  const n = Number((grade ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "NM";
  if (n >= 8) return "NM";
  if (n >= 6) return "LP";
  if (n >= 4) return "MP";
  if (n >= 2) return "HP";
  return "DMG";
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
    condition: conditionFromGrade(id.condition_assessment?.estimated_grade_low),
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
      // Each item keeps hold of its own file, so the upload below never has to
      // find it again by position.
      const fresh: Array<{ item: Item; file: File }> = images.map((file) => ({
        file,
        item: {
          key: nextKey(),
          uploads: [],
          previews: [URL.createObjectURL(file)],
          status: "uploading",
          error: null,
          identification: null,
          form: emptyForm(),
          price: null,
          pricing: false,
          savedId: null,
          hint: "",
          accentColor: null,
          duplicates: null,
        },
      }));
      setItems((prev) => [...fresh.map((f) => f.item), ...prev]);
      await Promise.all(
        fresh.map(async ({ item, file }) => {
          const fd = new FormData();
          fd.append("files", file);
          try {
            const { uploads } = await api<{ uploads: Array<{ name: string; color: string | null }> }>("/api/uploads", { method: "POST", body: fd });
            const names = uploads.map((u) => u.name);
            patch(item.key, { uploads: names, previews: names.map((n) => `/api/uploads/${n}`), accentColor: uploads[0]?.color ?? null });
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
        accentColor: null,
        duplicates: null,
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

  const save = async (item: Item, force = false) => {
    patch(item.key, { status: "saving", error: null });
    try {
      const input = formToInput(item.form);
      if (!input.name) throw new Error("Card name is required");
      if (!force) {
        const params = new URLSearchParams({ similar: "1", game: input.game, name: input.name });
        if (input.cardNumber) params.set("number", input.cardNumber);
        if (input.setName) params.set("set", input.setName);
        const { cards } = await api<{ cards: CardRecord[] }>(`/api/cards?${params}`);
        if (cards.length) {
          patch(item.key, { status: "review", duplicates: cards });
          return;
        }
      }
      const { card } = await api<{ card: CardRecord }>("/api/cards", {
        method: "POST",
        body: JSON.stringify({ ...input, imagePath: item.uploads[0] ?? null, accentColor: item.accentColor, identification: item.identification }),
      });
      // Store a first price snapshot so the collection view has a value right away.
      api(`/api/cards/${card.id}/price`, { method: "POST" }).catch(() => undefined);
      patch(item.key, { status: "saved", savedId: card.id });
    } catch (e) {
      patch(item.key, { status: "review", error: (e as Error).message });
    }
  };

  /**
   * Merge into an existing card: record what these copies cost as their own
   * purchase, and attach the photo if the card has none. Adding to the quantity
   * instead would say how many copies there are while losing what they cost,
   * which is exactly the moment a second copy is bought at a different price.
   */
  const addCopy = async (item: Item, existing: CardRecord) => {
    patch(item.key, { status: "saving", error: null });
    try {
      const input = formToInput(item.form);
      await api(`/api/cards/${existing.id}/acquisitions`, {
        method: "POST",
        body: JSON.stringify({ quantity: input.quantity ?? 1, unitCost: input.purchasePrice ?? null }),
      });
      if (!existing.imagePath && item.uploads[0]) {
        await api(`/api/cards/${existing.id}`, { method: "PATCH", body: JSON.stringify({ imagePath: item.uploads[0] }) });
      }
      patch(item.key, { status: "saved", savedId: existing.id, duplicates: null });
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
          onSaveAnyway={() => save(item, true)}
          onAddCopy={(existing) => addCopy(item, existing)}
          onDismissDuplicates={() => patch(item.key, { duplicates: null })}
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
  onSaveAnyway,
  onAddCopy,
  onDismissDuplicates,
  onRemove,
}: {
  item: Item;
  onChange: (f: CardFormState) => void;
  onHint: (h: string) => void;
  onReidentify: () => void;
  onExtraPhoto: (f: File) => void;
  onLookup: () => void;
  onSave: () => void;
  onSaveAnyway: () => void;
  onAddCopy: (existing: CardRecord) => void;
  onDismissDuplicates: () => void;
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
              <img key={src} src={src} alt="" className="w-full rounded-lg well object-contain" />
            ))
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center rounded-lg well text-sm text-neutral-400">
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
              {id.condition_assessment?.estimated_grade_low && (
                <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
                  Photo suggests a raw grade around{" "}
                  <strong>
                    {id.condition_assessment.estimated_grade_low}
                    {id.condition_assessment.estimated_grade_high && id.condition_assessment.estimated_grade_high !== id.condition_assessment.estimated_grade_low
                      ? `–${id.condition_assessment.estimated_grade_high}`
                      : ""}
                  </strong>
                  {id.condition_assessment.caveat ? ` · ${id.condition_assessment.caveat}` : ""}
                </div>
              )}
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
              {item.duplicates && item.duplicates.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                  <div className="font-medium">Looks like you already have this card</div>
                  <ul className="mt-2 space-y-2">
                    {item.duplicates.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <Link href={`/cards/${d.id}`} className="underline decoration-dotted">
                            {d.name}
                          </Link>{" "}
                          <span className="text-neutral-500">
                            {[d.setName, d.cardNumber ? `#${d.cardNumber}` : null, d.grade ? `${d.gradingCompany ?? ""} ${d.grade}` : `Raw · ${d.condition}`].filter(Boolean).join(" · ")} · qty {d.quantity}
                          </span>
                        </span>
                        <button type="button" className="btn-secondary" onClick={() => onAddCopy(d)} disabled={busy}>
                          Add as another copy
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={onSaveAnyway} disabled={busy}>
                      Save as a separate card
                    </button>
                    <button type="button" className="text-xs text-neutral-500 underline" onClick={onDismissDuplicates}>
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
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
