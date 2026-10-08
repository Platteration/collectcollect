"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import { exteriorFromName, guessCategory, isSouvenirName, isStatTrakName, splitName } from "@/lib/naming";
import {
  CATEGORIES,
  CATEGORY_IDS,
  EXTERIORS,
  EXTERIOR_IDS,
  RARITIES,
  RARITY_IDS,
  exteriorForFloat,
  hasWear,
  isStackable,
  type Category,
  type Exterior,
  type ItemInput,
  type ItemRecord,
  type Rarity,
} from "@/lib/types";
import { FloatBar } from "@/components/FloatBar";

/**
 * Adding one item by hand.
 *
 * The market hash name does most of the work: paste "StatTrak™ AK-47 | Redline
 * (Field-Tested)" and the kind, the gun, the finish, the wear tier and the
 * StatTrak flag all follow from it. Everything derived is shown filled in and
 * stays editable, so the form never claims to know something the owner cannot
 * correct.
 */
export function AddItemForm({ storageUnits }: { storageUnits: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [rarity, setRarity] = useState<Rarity | "">("");
  const [exterior, setExterior] = useState<Exterior | "">("");
  const [floatText, setFloatText] = useState("");
  const [paintSeed, setPaintSeed] = useState("");
  const [collection, setCollection] = useState("");
  const [nameTag, setNameTag] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [storageUnit, setStorageUnit] = useState("");
  const [tradableAfter, setTradableAfter] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the name says, recomputed as it is typed. A field the owner has set is
  // never overwritten: these only fill in the blanks.
  const read = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    return {
      category: guessCategory(trimmed),
      exterior: exteriorFromName(trimmed),
      stattrak: isStatTrakName(trimmed),
      souvenir: isSouvenirName(trimmed),
      ...splitName(trimmed),
    };
  }, [name]);

  const effectiveCategory = (category || read?.category || "") as Category | "";
  const wearable = effectiveCategory !== "" && hasWear(effectiveCategory);
  const stacks = effectiveCategory !== "" && isStackable(effectiveCategory);

  const floatValue = floatText.trim() === "" ? null : Number(floatText);
  const floatUsable = floatValue !== null && Number.isFinite(floatValue) && floatValue >= 0 && floatValue <= 1;
  // The float is what the wear tier *is*, so it overrides both the name and the
  // chosen tier rather than sitting next to them.
  const effectiveExterior = floatUsable ? exteriorForFloat(floatValue) : ((exterior || read?.exterior || null) as Exterior | null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input: ItemInput = {
      marketHashName: name.trim(),
      category: effectiveCategory || "other",
      weapon: read?.weapon ?? null,
      finish: read?.finish ?? null,
      exterior: effectiveExterior,
      rarity: rarity || null,
      collection: collection.trim() || null,
      stattrak: read?.stattrak ?? false,
      souvenir: read?.souvenir ?? false,
      floatValue: floatUsable ? floatValue : null,
      paintSeed: paintSeed.trim() === "" ? null : Number(paintSeed),
      nameTag: nameTag.trim() || null,
      quantity: stacks ? Math.max(1, Number(quantity) || 1) : 1,
      purchasePrice: price.trim() === "" ? null : Number(price),
      storageUnit: storageUnit.trim() || null,
      tradableAfter: tradableAfter || null,
      notes: notes.trim() || null,
    };
    try {
      const { item } = await api<{ item: ItemRecord }>("/api/items", { method: "POST", body: JSON.stringify(input) });
      router.push(`/items/${item.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label" htmlFor="market-hash-name">
          Market hash name
        </label>
        <input
          id="market-hash-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="StatTrak™ AK-47 | Redline (Field-Tested)"
          autoFocus
          required
        />
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Exactly as Steam writes it. Every market agrees on this name, so it is
          what prices will be looked up by.
        </p>
        {read && (
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {read.category ? (
              <>
                Read as <strong>{CATEGORIES[read.category]}</strong>
                {read.weapon && <> · {read.weapon}</>}
                {read.finish && <> · {read.finish}</>}
                {read.exterior && <> · {EXTERIORS[read.exterior]}</>}
                {read.stattrak && <> · StatTrak™</>}
                {read.souvenir && <> · Souvenir</>}
              </>
            ) : (
              <>Nothing in that name says what kind of item it is, so choose one below.</>
            )}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="category">
            Kind
          </label>
          <select id="category" className="input" value={effectiveCategory} onChange={(e) => setCategory(e.target.value as Category)} required>
            <option value="">Choose…</option>
            {CATEGORY_IDS.map((id) => (
              <option key={id} value={id}>
                {CATEGORIES[id]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="rarity">
            Rarity
          </label>
          <select id="rarity" className="input" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
            <option value="">Not recorded</option>
            {RARITY_IDS.map((id) => (
              <option key={id} value={id}>
                {RARITIES[id].label}
              </option>
            ))}
          </select>
        </div>

        {wearable && (
          <>
            <div>
              <label className="label" htmlFor="float">
                Float
              </label>
              <input
                id="float"
                className="input"
                inputMode="decimal"
                value={floatText}
                onChange={(e) => setFloatText(e.target.value)}
                placeholder="0.2213"
              />
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {floatText.trim() === ""
                  ? "Leave blank if you have not inspected it. Nothing is guessed from a blank."
                  : floatUsable
                    ? `Sets the wear tier to ${EXTERIORS[effectiveExterior!]}.`
                    : "A float is a number between 0 and 1."}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="exterior">
                Wear tier
              </label>
              <select
                id="exterior"
                className="input"
                value={effectiveExterior ?? ""}
                onChange={(e) => setExterior(e.target.value as Exterior)}
                disabled={floatUsable}
              >
                <option value="">Not recorded</option>
                {EXTERIOR_IDS.map((id) => (
                  <option key={id} value={id}>
                    {EXTERIORS[id]}
                  </option>
                ))}
              </select>
              {floatUsable && (
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  Decided by the float.
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="paint-seed">
                Pattern seed
              </label>
              <input id="paint-seed" className="input" inputMode="numeric" value={paintSeed} onChange={(e) => setPaintSeed(e.target.value)} />
            </div>

            <div>
              <label className="label" htmlFor="name-tag">
                Name tag
              </label>
              <input id="name-tag" className="input" value={nameTag} onChange={(e) => setNameTag(e.target.value)} />
            </div>
          </>
        )}

        {stacks && (
          <div>
            <label className="label" htmlFor="quantity">
              How many
            </label>
            <input id="quantity" className="input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        )}

        <div>
          <label className="label" htmlFor="price">
            Paid, each
          </label>
          <input id="price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="42.00" />
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Leave blank if it came from a case or a trade. Blank means “nobody
            knows”, which is a different thing from free.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="collection">
            Collection
          </label>
          <input id="collection" className="input" value={collection} onChange={(e) => setCollection(e.target.value)} />
        </div>

        <div>
          <label className="label" htmlFor="storage-unit">
            Kept in
          </label>
          <input
            id="storage-unit"
            className="input"
            list="storage-units"
            value={storageUnit}
            onChange={(e) => setStorageUnit(e.target.value)}
          />
          <datalist id="storage-units">
            {storageUnits.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label" htmlFor="tradable-after">
            Trade locked until
          </label>
          <input id="tradable-after" className="input" type="date" value={tradableAfter} onChange={(e) => setTradableAfter(e.target.value)} />
        </div>
      </div>

      {floatUsable && (
        <div className="card-surface p-4">
          <span className="label">Where that sits</span>
          <FloatBar value={floatValue} />
        </div>
      )}

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--chart-bad-text)" }}>
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy || !name.trim() || !effectiveCategory}>
        {busy ? "Saving…" : "Add to inventory"}
      </button>
    </form>
  );
}
