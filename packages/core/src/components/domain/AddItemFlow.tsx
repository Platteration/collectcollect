"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import Link from "next/link";
import { api } from "../../api-client";
import type { FieldSpec, Identification } from "../../domain/spec";
import { ItemForm, emptyForm, fillForm, formToInput, type ItemFormValue } from "./ItemForm";

type Status = "idle" | "uploading" | "identifying" | "saving" | "saved";

interface Props {
  fields: FieldSpec[];
  noun: { singular: string; plural: string };
  /** Whether photos can be identified at all (a prompt exists and a key is set). */
  canIdentify: boolean;
  /** Whether the app has an identification prompt, so the photo panel says why nothing happens without a key. */
  hasIdentify: boolean;
  locations: string[];
}

interface Candidate {
  id: number;
  title: string;
  detail: string;
  quantity: number;
}

/**
 * Adding one thing: drop a photo and let the model read it, or fill the form
 * by hand; either way the form is reviewed before anything is saved. Saving
 * goes through intake, so a copy of something already held joins its stack
 * and a lookalike stops for a decision instead of being guessed at.
 */
export function AddItemFlow({ fields, noun, canIdentify, hasIdentify, locations }: Props) {
  const [form, setForm] = useState<ItemFormValue>(() => emptyForm(fields));
  const [photos, setPhotos] = useState<Array<{ name: string; color: string | null }>>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [identification, setIdentification] = useState<Identification | null>(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: number; merged: boolean; title: string } | null>(null);
  const [ambiguous, setAmbiguous] = useState<Candidate[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = status === "uploading" || status === "identifying" || status === "saving";

  const upload = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/")).slice(0, 4 - photos.length);
    if (images.length === 0) return;
    setStatus("uploading");
    setError(null);
    try {
      const fd = new FormData();
      for (const f of images) fd.append("files", f);
      const { uploads } = await api<{ uploads: Array<{ name: string; color: string | null }> }>("/api/uploads", { method: "POST", body: fd });
      const next = [...photos, ...uploads];
      setPhotos(next);
      setStatus("idle");
      if (canIdentify && photos.length === 0) await identify(next.map((p) => p.name), hint);
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  };

  const identify = async (names: string[], withHint: string) => {
    if (names.length === 0) return;
    setStatus("identifying");
    setError(null);
    try {
      const res = await api<{ identification: Identification; input: Record<string, unknown> }>("/api/identify", {
        method: "POST",
        body: JSON.stringify({ uploads: names, hint: withHint || undefined }),
      });
      setIdentification(res.identification);
      setForm((f) => fillForm(fields, f, res.input));
    } catch (e) {
      setError(`Identification failed: ${(e as Error).message}. Fill in the details by hand.`);
    } finally {
      setStatus("idle");
    }
  };

  const save = async (force = false) => {
    setStatus("saving");
    setError(null);
    setAmbiguous(null);
    try {
      const input = { ...formToInput(fields, form), photos: photos.map((p) => p.name), accentColor: photos[0]?.color ?? null, identification };
      if (force) {
        const { item } = await api<{ item: { id: number } }>("/api/items", { method: "POST", body: JSON.stringify(input) });
        void api(`/api/items/${item.id}/price`, { method: "POST" }).catch(() => undefined);
        setSaved({ id: item.id, merged: false, title: String(form.fields[fields[0]?.key] ?? "") });
        setStatus("saved");
        return;
      }
      const outcome = await api<
        | { result: "created" | "merged"; item: { id: number; quantity: number } }
        | { result: "ambiguous"; candidates: Array<{ id: number; quantity: number } & Record<string, unknown>> }
      >("/api/items/intake", { method: "POST", body: JSON.stringify(input) });
      if (outcome.result === "ambiguous") {
        setAmbiguous(
          outcome.candidates.map((c) => ({
            id: c.id,
            title: String(c[fields[0]?.key] ?? `#${c.id}`),
            detail: fields
              .slice(1, 4)
              .map((f) => c[f.key])
              .filter(Boolean)
              .join(" · "),
            quantity: c.quantity,
          })),
        );
        setStatus("idle");
        return;
      }
      void api(`/api/items/${outcome.item.id}/price`, { method: "POST" }).catch(() => undefined);
      setSaved({ id: outcome.item.id, merged: outcome.result === "merged", title: String(form.fields[fields[0]?.key] ?? "") });
      setStatus("saved");
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  };

  const reset = () => {
    setForm(emptyForm(fields));
    setPhotos([]);
    setIdentification(null);
    setSaved(null);
    setAmbiguous(null);
    setError(null);
    setStatus("idle");
  };

  if (saved) {
    return (
      <div className="card-surface space-y-3 p-6">
        <p className="text-lg font-medium">
          {saved.merged ? `Added as another copy of ${saved.title}.` : `Saved ${saved.title} to your ${noun.plural}.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/items/${saved.id}`} className="btn-primary">
            Open it
          </Link>
          <button type="button" className="btn-secondary" onClick={reset}>
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
      <div className="space-y-2">
        <div
          className="card-surface flex flex-col items-center gap-2 border-2 border-dashed p-4 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          {photos.length ? (
            photos.map((p) => <img key={p.name} src={`/api/uploads/${p.name}`} alt="" className="w-full rounded-lg well object-contain" />)
          ) : (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {hasIdentify ? "Drop a photo here and it will be read for you." : "Drop a photo to keep with the record."}
            </p>
          )}
          <button type="button" className="btn-secondary w-full" onClick={() => fileInput.current?.click()} disabled={busy || photos.length >= 4}>
            {photos.length ? "+ Another photo" : "Choose photo"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          {hasIdentify && !canIdentify && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              ANTHROPIC_API_KEY is not set, so photos are kept but not read.
            </p>
          )}
        </div>
        {photos.length > 0 && canIdentify && (
          <div className="space-y-1">
            <input className="input" placeholder="Hint (e.g. 'PAL version')" value={hint} onChange={(e) => setHint(e.target.value)} />
            <button type="button" className="btn-secondary w-full" onClick={() => identify(photos.map((p) => p.name), hint)} disabled={busy}>
              {status === "identifying" ? "Reading…" : "Re-identify"}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {status === "identifying" && (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
            <span className="h-3 w-3 animate-pulse rounded-full" style={{ background: "var(--accent-solid)" }} /> Reading the photo…
          </div>
        )}
        {identification && (
          <div className="card-surface p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Read from the photo</span>
              <span className={`badge ${identification.confidence >= 0.8 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"}`}>
                {Math.round(identification.confidence * 100)}% confident
              </span>
            </div>
            {identification.alternatives.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--muted)" }}>
                {identification.alternatives.map((alt, i) => (
                  <li key={i}>
                    Could also be <strong>{alt.label}</strong> — {alt.reason}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Check the fields below before saving; the model is a first read, not a verdict.
            </p>
          </div>
        )}
        {error && (
          <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }}>
            {error}
          </p>
        )}
        <ItemForm fields={fields} value={form} onChange={setForm} disabled={busy} locations={locations} idPrefix="add" />
        {ambiguous && (
          <div className="card-surface space-y-2 p-3 text-sm" style={{ borderColor: "var(--line-strong)" }}>
            <p className="font-medium">
              {ambiguous.length} of your {noun.plural} look like this one, so nothing was saved.
            </p>
            <ul className="space-y-1">
              {ambiguous.map((c) => (
                <li key={c.id}>
                  <Link href={`/items/${c.id}`} className="underline decoration-dotted">
                    {c.title}
                  </Link>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    {c.detail} · {c.quantity} held
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn-secondary" onClick={() => save(true)} disabled={busy}>
              Save as a separate {noun.singular}
            </button>
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={() => save(false)} disabled={busy || !(form.fields[fields[0]?.key] ?? "").trim()}>
            {status === "saving" ? "Saving…" : `Save ${noun.singular}`}
          </button>
        </div>
      </div>
    </div>
  );
}
