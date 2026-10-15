"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, runQueue, withRetryAfter } from "@/lib/api-client";
import type { ScanDraft } from "@/lib/scan-types";
import type { CardRecord } from "@/lib/types";
import { CardForm, formFromCard, formToInput } from "./CardForm";

type Pending = { id: string; file: File; error: string | null };
const labels: Record<ScanDraft["status"], string> = { queued: "Waiting", identifying: "Reading", ready: "Saving", review: "Needs review", failed: "Failed", committed: "Saved", discarded: "Discarded" };

interface ScanItem {
  key: string;
  file: File;
  preview: string;
  status: ScanStatus;
  upload: string | null;
  accentColor: string | null;
  identification: Identification | null;
  cardId: number | null;
  message: string | null;
}

const CONCURRENCY = 2;
/** Below this confidence a card is set aside rather than saved unattended. */
const AUTO_SAVE_CONFIDENCE = 0.8;

let counter = 0;
const nextKey = () => `scan-${Date.now()}-${counter++}`;

const STATUS_LABEL: Record<ScanStatus, string> = {
  queued: "Waiting",
  uploading: "Uploading",
  identifying: "Reading",
  saving: "Saving",
  added: "Added",
  merged: "Extra copy",
  review: "Needs review",
  failed: "Failed",
};

const STATUS_STYLE: Record<ScanStatus, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100",
  uploading: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100",
  identifying: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  saving: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  added: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  merged: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  review: "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100",
  failed: "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100",
};

function conditionFromGrade(grade: string | null | undefined): string {
  const n = Number((grade ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "NM";
  if (n >= 8) return "NM";
  if (n >= 6) return "LP";
  if (n >= 4) return "MP";
  if (n >= 2) return "HP";
  return "DMG";
}

/**
 * Batch capture: photograph a stack one card at a time and let each shot run
 * through identify, duplicate check and save on its own. Only cards the model
 * was unsure about stop for review, so a binder can be worked through without
 * touching the keyboard.
 */
export function ScanFlow({ claudeConfigured }: { claudeConfigured: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<ScanItem[]>([]);
  const [camera, setCamera] = useState<"idle" | "starting" | "live" | "unavailable">("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<ScanItem[]>([]);
  const runningRef = useRef(0);
  const draining = useRef(false);

  const patch = useCallback((key: string, p: Partial<ScanItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
  }, []);

  const processOne = useCallback(
    async (item: ScanItem) => {
      try {
        patch(item.key, { status: "uploading" });
        const fd = new FormData();
        fd.append("files", item.file);
        const { uploads } = await api<{ uploads: Array<{ name: string; color: string | null }> }>("/api/uploads", { method: "POST", body: fd });
        const upload = uploads[0];
        patch(item.key, { upload: upload.name, accentColor: upload.color });

        if (!claudeConfigured) {
          patch(item.key, { status: "review", message: "Claude is not configured, so this card needs details by hand." });
          return;
        }

        patch(item.key, { status: "identifying" });
        const { identification } = await api<{ identification: Identification }>("/api/identify", {
          method: "POST",
          body: JSON.stringify({ uploads: [upload.name] }),
        });
        patch(item.key, { identification });

        if (identification.confidence < AUTO_SAVE_CONFIDENCE) {
          patch(item.key, {
            status: "review",
            message: `Only ${Math.round(identification.confidence * 100)}% sure this is ${identification.name}.`,
          });
          return;
        }

        patch(item.key, { status: "saving" });
        const assess = identification.condition_assessment ?? null;
        // One atomic call decides between merge and create, so two workers
        // scanning the same card cannot both add a fresh row or lose a copy.
        const outcome = await api<IntakeOutcome>("/api/cards/intake", {
          method: "POST",
          body: JSON.stringify({
            game: identification.game,
            name: identification.name,
            sport: identification.sport,
            setName: identification.set_name,
            setCode: identification.set_code,
            cardNumber: identification.card_number,
            year: identification.year,
            rarity: identification.rarity,
            variant: identification.variant,
            language: identification.language,
            manufacturer: identification.manufacturer,
            team: identification.team ?? null,
            rookie: Boolean(identification.rookie),
            parallel: identification.parallel ?? null,
            serialNumber: identification.serial_number ?? null,
            autograph: Boolean(identification.autograph),
            relic: Boolean(identification.relic),
            condition: conditionFromGrade(assess?.estimated_grade_low),
            gradingCompany: identification.grading.company,
            grade: identification.grading.grade,
            certNumber: identification.grading.cert_number,
            subgrades: identification.grading.subgrades ?? null,
            notes: identification.condition_notes ? `Condition notes: ${identification.condition_notes}` : null,
            imagePath: upload.name,
            accentColor: upload.color,
            identification,
          }),
        });

        if (outcome.result === "ambiguous") {
          patch(item.key, {
            status: "review",
            message:
              outcome.candidates.length === 1
                ? `You already have a ${outcome.candidates[0].grade ? `${outcome.candidates[0].gradingCompany ?? "graded"} ${outcome.candidates[0].grade}` : "raw"} copy; this one looks different.`
                : `${outcome.candidates.length} cards in your collection look like this one.`,
          });
          return;
        }
        // Price in the background; the scan should not wait on provider APIs.
        void api(`/api/cards/${outcome.card.id}/price`, { method: "POST" }).catch(() => undefined);
        patch(item.key, {
          status: outcome.result === "merged" ? "merged" : "added",
          cardId: outcome.card.id,
          message: outcome.result === "merged" ? `Now ${outcome.card.quantity} copies of ${outcome.card.name}.` : null,
        });
      } catch (e) {
        patch(item.key, { status: "failed", message: (e as Error).message });
      }
    },
    [claudeConfigured, patch],
  );

  /**
   * A fixed pool of workers pulls from the shared queue until it is empty.
   * `tick` restarts the pool when work arrives, so no function has to call
   * itself recursively to keep the queue moving.
   */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (draining.current || queueRef.current.length === 0) return;
    draining.current = true;
    void (async () => {
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (;;) {
            const item = queueRef.current.shift();
            if (!item) return;
            runningRef.current += 1;
            await processOne(item);
            runningRef.current -= 1;
          }
        }),
      );
      draining.current = false;
      // Anything queued while the pool was winding down starts a fresh pass.
      if (queueRef.current.length > 0) setTick((t) => t + 1);
      else router.refresh();
    })();
  }, [tick, processOne, router]);

  const enqueue = useCallback(
    (files: File[]) => {
      const fresh = files
        .filter((f) => f.type.startsWith("image/"))
        .map<ScanItem>((file) => ({
          key: nextKey(),
          file,
          preview: URL.createObjectURL(file),
          status: "queued",
          upload: null,
          accentColor: null,
          identification: null,
          cardId: null,
          message: null,
        }));
      if (fresh.length === 0) return;
      setItems((prev) => [...fresh, ...prev]);
      queueRef.current.push(...fresh);
      setTick((t) => t + 1);
    },
    [],
  );

  const startCamera = useCallback(async () => {
    setCamera("starting");
    setCameraError(null);
    try {
      let current = draft;
      if (current.status !== "ready") {
        if (!claudeConfigured) return;
        const response = await withRetryAfter(() => api<{ draft: ScanDraft }>(`/api/scan-drafts/${draft.id}/identify`, { method: "POST", body: JSON.stringify({ revision: draft.revision }) }));
        current = response.draft; replace(current);
      }
      if (current.status === "ready") {
        attempted.current.set(current.id, current.revision);
        const response = await api<{ draft: ScanDraft }>(`/api/scan-drafts/${draft.id}/commit`, { method: "POST", body: JSON.stringify({ revision: current.revision, mode: "auto" }) });
        replace(response.draft);
        if (response.draft.cardId) void api(`/api/cards/${response.draft.cardId}/price`, { method: "POST" }).catch(() => undefined);
      }
    } catch (e) { setError((e as Error).message); await reload().catch(() => undefined); }
    finally { running.current.delete(draft.id); }
  }, [claudeConfigured, reload, replace]);
  useEffect(() => {
    const available = drafts.filter((draft) => (draft.status === "ready" || (claudeConfigured && draft.status === "queued")) &&
      !running.current.has(draft.id) && attempted.current.get(draft.id) !== draft.revision);
    // Reserve queued work before launching it. A rejected revision waits for
    // explicit Retry instead of retrying on every poll or unrelated render.
    for (const draft of available) attempted.current.set(draft.id, draft.revision);
    void runQueue(available.map((draft) => () => process(draft)));
  }, [claudeConfigured, drafts, process]);
  useEffect(() => { const timer = setInterval(() => { void reload().catch(() => undefined); }, 4000); return () => clearInterval(timer); }, [reload]);
  useEffect(() => { if (camera && video.current && stream.current) { video.current.srcObject = stream.current; void video.current.play().catch(() => setError("Camera preview could not start. Choose photos instead.")); } }, [camera]);
  useEffect(() => () => { stream.current?.getTracks().forEach((track) => track.stop()); }, []);

  const upload = async (item: Pending) => {
    try {
      const body = new FormData(); body.append("files", item.file); body.append("draftId", item.id);
      const result = await withRetryAfter(() => api<{ draft: ScanDraft }>("/api/uploads", { method: "POST", body }));
      replace(result.draft); setPending((all) => all.filter((p) => p.id !== item.id)); await process(result.draft);
    } catch (e) { setPending((all) => all.map((p) => p.id === item.id ? { ...p, error: (e as Error).message } : p)); }
  };
  const enqueue = (incoming: File[]) => {
    const fresh = incoming.filter((f) => f.type.startsWith("image/")).map((file) => ({ id: crypto.randomUUID(), file, error: null }));
    setPending((all) => [...all, ...fresh]); void runQueue(fresh.map((item) => () => upload(item)));
  };
  const startCamera = async () => { try { stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } } }); setCamera(true); } catch (e) { setError(`Camera unavailable. Choose photos instead. ${(e as Error).message}`); } };
  const capture = () => {
    const live = video.current; if (!live?.videoWidth) return;
    const canvas = document.createElement("canvas"); canvas.width = live.videoWidth; canvas.height = live.videoHeight; canvas.getContext("2d")?.drawImage(live, 0, 0);
    canvas.toBlob((blob) => { if (blob) enqueue([new File([blob], "scan.jpg", { type: "image/jpeg" })]); }, "image/jpeg", 0.9);
  };
  const current = drafts.find((d) => d.id === selected);
  const visible = drafts.filter((d) => d.status !== "discarded");
  const reviewCount = visible.filter((d) => ["review", "failed"].includes(d.status) || (!claudeConfigured && d.status === "queued")).length;
  return <div className="space-y-5">
    <section className="card-surface space-y-3 p-4">
      <h2 className="font-semibold">Scan a stack</h2>
      <p className="text-sm text-[var(--muted)]">Each uploaded photo is saved to your inbox. Confident matches save automatically; uncertain cards stay here for review, even after you close the page.</p>
      <div className="flex flex-wrap gap-2">
        {camera ? <><button className="btn-primary" onClick={capture}>Capture</button><button className="btn-secondary" onClick={() => { stream.current?.getTracks().forEach((t) => t.stop()); setCamera(false); }}>Stop camera</button></> : <button className="btn-secondary" onClick={startCamera}>Use camera</button>}
        <button className="btn-primary" onClick={() => files.current?.click()}>Choose photos</button>
        <input ref={files} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { enqueue(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {camera && <video ref={video} className="max-h-[50vh] w-full bg-black" playsInline muted />}
      {!claudeConfigured && <p className="text-sm text-amber-700 dark:text-amber-300">Identification is not configured. Your photos are saved; use Review to enter details by hand.</p>}
      {pending.map((p) => <div key={p.id} className="text-sm" role="status">{p.file.name}: {p.error ? <>Not saved: {p.error} <button className="underline" onClick={() => void upload(p)}>Retry upload</button></> : "Uploading — keep this page open until saved."}</div>)}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error} <button className="underline" onClick={() => { setError(null); void reload(); }}>Reload inbox</button></p>}
    </section>
    <div className="flex flex-wrap gap-4 text-sm" role="status"><span>{visible.filter((d) => d.result === "created").length} added</span><span>{visible.filter((d) => d.result === "merged").length} extra copies</span><span>{reviewCount} need review</span><Link href="/collection" className="ml-auto underline">View collection</Link></div>
    {current && <DraftReview key={current.id} draft={current} onChange={replace} onClose={() => setSelected(null)} onIdentify={process} claudeConfigured={claudeConfigured} />}
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {visible.map((draft) => <li key={draft.id} className="card-surface overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/uploads/${draft.uploads[0]}`} alt={draft.input.name || "Scanned card"} loading="lazy" className="aspect-[3/4] w-full object-contain" />
        <div className="space-y-1 p-3 text-sm"><strong>{draft.input.name || "Scanned card"}</strong><p>{draft.result === "merged" ? "Extra copy" : labels[draft.status]}</p>
          {draft.uploads.length > 1 && <p className="text-xs text-[var(--muted)]">{draft.uploads.length} saved photos</p>}
          {draft.message && <p className="text-xs text-[var(--muted)]">{draft.message}</p>}
          {draft.cardId ? <Link className="underline" href={`/cards/${draft.cardId}`}>Open card</Link> : <div className="flex flex-wrap gap-3">
            <button className="underline" disabled={draft.status === "identifying"} onClick={() => setSelected(draft.id)}>Review</button>
            {(draft.status === "failed" || draft.status === "queued" || draft.status === "ready") && claudeConfigured && <button className="underline" onClick={() => void process(draft)}>Retry</button>}
            <button className="underline" disabled={draft.status === "identifying"} onClick={async () => { try { const r = await api<{ draft: ScanDraft }>(`/api/scan-drafts/${draft.id}/discard`, { method: "POST", body: JSON.stringify({ revision: draft.revision }) }); replace(r.draft); } catch (e) { setError((e as Error).message); } }}>Discard</button>
          </div>}
        </div>
      </li>)}
    </ul>
  </div>;
}

function DraftReview({ draft, onChange, onClose, onIdentify, claudeConfigured }: { draft: ScanDraft; onChange: (draft: ScanDraft) => void; onClose: () => void; onIdentify: (draft: ScanDraft) => Promise<void>; claudeConfigured: boolean }) {
  const editorRef = useRef<HTMLElement>(null);
  const [base, setBase] = useState(draft);
  const [form, setForm] = useState(() => formFromCard({ ...draft.input, game: draft.input.game ?? "pokemon", name: draft.input.name ?? "" }));
  const [hint, setHint] = useState(draft.hint);
  const [candidates, setCandidates] = useState<CardRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { editorRef.current?.scrollIntoView({ block: "start" }); editorRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);
  useEffect(() => { void api<{ candidates: CardRecord[] }>(`/api/scan-drafts/${draft.id}`).then((r) => setCandidates(r.candidates)).catch(() => undefined); }, [draft.id, draft.revision]);
  const locked = ["identifying", "committed", "discarded"].includes(draft.status);
  const loadSaved = (saved: ScanDraft) => {
    setBase(saved); setForm(formFromCard({ ...saved.input, game: saved.input.game ?? "pokemon", name: saved.input.name ?? "" })); setHint(saved.hint); setError(null); onChange(saved);
  };
  const reloadSaved = async () => loadSaved((await api<{ draft: ScanDraft }>(`/api/scan-drafts/${draft.id}`)).draft);
  const saveDraft = async () => {
    const saved = (await api<{ draft: ScanDraft }>(`/api/scan-drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify({ revision: base.revision, input: formToInput(form), hint }) })).draft;
    setBase(saved); onChange(saved); return saved;
  };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(null); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const commit = (target?: number) => run(async () => {
    const saved = await saveDraft();
    const result = await api<{ draft: ScanDraft }>(`/api/scan-drafts/${draft.id}/commit`, { method: "POST", body: JSON.stringify({ revision: saved.revision, mode: target ? "merge" : "separate", targetId: target }) });
    onChange(result.draft); onClose();
    if (result.draft.cardId) void api(`/api/cards/${result.draft.cardId}/price`, { method: "POST" }).catch(() => undefined);
  });
  return <section ref={editorRef} className="card-surface space-y-4 p-4" aria-label="Review scanned card">
    <div className="flex justify-between gap-3"><h2 className="font-semibold">Review scanned card</h2><button className="underline" onClick={onClose}>Close review</button></div>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    {draft.status === "discarded" && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">This scan was discarded. Your entries remain visible here, but it can no longer be saved.</p>}
    {draft.revision !== base.revision && <p className="text-sm text-amber-700 dark:text-amber-300">This scan changed elsewhere. Your unsaved edits are still here. <button className="underline" onClick={() => void run(reloadSaved)}>Reload and discard my edits</button></p>}
    {draft.identification && <p className="text-sm">{Math.round(draft.identification.confidence * 100)}% confident. {draft.identification.condition_assessment?.caveat}</p>}
    {draft.identification?.alternatives.map((alt, i) => <button key={i} className="block text-sm underline" disabled={busy || locked} onClick={() => setForm({ ...form, name: alt.name, setName: alt.set_name ?? form.setName, cardNumber: alt.card_number ?? form.cardNumber })}>{alt.name} · {alt.reason}</button>)}
    <div className="space-y-2"><p className="text-sm">{draft.uploads.length} saved {draft.uploads.length === 1 ? "photo" : "photos"}</p><div className="flex flex-wrap gap-2">
      {draft.uploads.map((name, index) => <a key={name} href={`/api/uploads/${name}`} target="_blank" rel="noreferrer" aria-label={`Open saved photo ${index + 1}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/uploads/${name}`} alt={`Saved photo ${index + 1}`} loading="lazy" className="h-28 w-20 rounded object-contain" />
      </a>)}
    </div></div>
    <CardForm value={form} onChange={setForm} disabled={busy || locked} />
    <label className="block"><span className="label">Identification hint</span><input className="input" value={hint} maxLength={2000} disabled={busy || locked} onChange={(e) => setHint(e.target.value)} /></label>
    <div className="flex flex-wrap gap-3">
      <button className="btn-secondary" disabled={busy || locked} onClick={() => void run(async () => onChange(await saveDraft()))}>Save draft</button>
      <button className="btn-secondary" disabled={busy || !claudeConfigured || locked} onClick={() => void run(async () => { const saved = await saveDraft(); onChange(saved); await onIdentify(saved); await reloadSaved(); })}>Re-identify</button>
      <label className="btn-secondary cursor-pointer">Add back or label photo<input type="file" accept="image/*" className="hidden" disabled={busy || locked || draft.uploads.length >= 4} onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; void run(async () => { const body = new FormData(); body.append("files", file); const r = await api<{ uploads: Array<{ name: string }> }>("/api/uploads", { method: "POST", body }); const name = r.uploads[0]?.name; if (!name) throw new Error("Photo was not saved"); const saved = await api<{ draft: ScanDraft }>(`/api/scan-drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify({ revision: base.revision, input: formToInput(form), hint, uploads: [...draft.uploads, name] }) }); loadSaved(saved.draft); }); }} /></label>
      <button className="btn-primary" disabled={busy || !form.name.trim() || locked} onClick={() => void commit()}>{candidates.length ? "Save as a separate card" : "Save to collection"}</button>
    </div>
    {candidates.map((card) => <div key={card.id} className="flex flex-wrap items-center gap-3 text-sm"><span>Already owned: {card.name} · {card.grade ? `${card.gradingCompany} ${card.grade}` : `Raw ${card.condition}`} · {card.quantity} copies</span><button className="underline" disabled={busy || locked} onClick={() => void commit(card.id)}>Add as another copy</button></div>)}
  </section>;
}
