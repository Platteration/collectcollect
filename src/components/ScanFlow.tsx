"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { Game, Identification } from "@/lib/types";
import type { IntakeOutcome } from "@/lib/cards";
import { GAMES } from "@/lib/types";

type ScanStatus = "queued" | "uploading" | "identifying" | "saving" | "added" | "merged" | "review" | "failed";

interface ScanItem {
  key: string;
  /** Dropped once the photo is on the server, so a long stack does not keep every capture. */
  file: File | null;
  /** A blob: URL until the upload lands, then the stored copy. */
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
  /**
   * Blob URLs still owned by this component. A full-resolution capture stays in
   * memory for as long as its URL exists, and scanning a binder makes one per
   * shutter press, so each is released as soon as the server has the photo and
   * any survivors are released on unmount.
   */
  const blobUrls = useRef(new Set<string>());

  const revoke = useCallback((url: string) => {
    if (!blobUrls.current.delete(url)) return;
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const urls = blobUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const patch = useCallback((key: string, p: Partial<ScanItem>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
  }, []);

  const processOne = useCallback(
    async (item: ScanItem) => {
      try {
        const file = item.file;
        if (!file) return; // already uploaded; nothing left to do with this item
        patch(item.key, { status: "uploading" });
        const fd = new FormData();
        fd.append("files", file);
        const { uploads } = await api<{ uploads: Array<{ name: string; color: string | null }> }>("/api/uploads", { method: "POST", body: fd });
        const upload = uploads[0];
        // The server has the photo now: show its copy and let go of both the
        // capture and the blob URL that was holding it in memory.
        patch(item.key, { upload: upload.name, accentColor: upload.color, preview: `/api/uploads/${upload.name}`, file: null });
        revoke(item.preview);

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
            condition: conditionFromGrade(assess?.estimated_grade_low),
            gradingCompany: identification.grading.company,
            grade: identification.grading.grade,
            certNumber: identification.grading.cert_number,
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
    [claudeConfigured, patch, revoke],
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
        .map<ScanItem>((file) => {
          const preview = URL.createObjectURL(file);
          blobUrls.current.add(preview);
          return {
            key: nextKey(),
            file,
            preview,
            status: "queued",
            upload: null,
            accentColor: null,
            identification: null,
            cardId: null,
            message: null,
          };
        });
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
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      });
      setCamera("live");
    } catch (e) {
      setCamera("unavailable");
      setCameraError(e instanceof Error ? e.message : "No camera available");
    }
  }, []);

  // The <video> only exists once the camera is live, so the stream is attached
  // after that render rather than inside startCamera, where the ref is null.
  useEffect(() => {
    const video = videoRef.current;
    if (camera !== "live" || !video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    void video.play().catch(() => setCameraError("The preview could not start"));
  }, [camera]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera("idle");
  }, []);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) enqueue([new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" })]);
    }, "image/jpeg", 0.9);
  }, [enqueue]);

  const counts = items.reduce<Record<ScanStatus, number>>(
    (acc, it) => ({ ...acc, [it.status]: (acc[it.status] ?? 0) + 1 }),
    {} as Record<ScanStatus, number>,
  );
  const working = (counts.queued ?? 0) + (counts.uploading ?? 0) + (counts.identifying ?? 0) + (counts.saving ?? 0);
  const needsReview = items.filter((i) => i.status === "review" || i.status === "failed");

  return (
    <div className="space-y-5">
      <section className="card-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Scan a stack</h2>
            <p className="max-w-xl text-sm text-neutral-500">
              Shoot one card at a time and keep going. Each photo is identified, checked against what you already own and
              saved on its own; extra copies of a card you have are merged automatically. Only cards the model was unsure
              about wait for you at the end.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {camera === "live" ? (
              <>
                <button type="button" className="btn-primary" onClick={capture}>
                  Capture
                </button>
                <button type="button" className="btn-secondary" onClick={stopCamera}>
                  Stop camera
                </button>
              </>
            ) : (
              <button type="button" className="btn-secondary" onClick={startCamera} disabled={camera === "starting"}>
                {camera === "starting" ? "Starting…" : "Use camera"}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>
              Choose photos
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                enqueue(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {camera === "live" && (
          <div className="mt-3 overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="mx-auto max-h-[50vh]" playsInline muted />
          </div>
        )}
        {cameraError && (
          <p className="mt-2 text-xs text-neutral-500">
            Camera unavailable ({cameraError}). Choose photos instead, which works the same way.
          </p>
        )}
        {!claudeConfigured && (
          <p className="mt-3 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            ANTHROPIC_API_KEY is not set, so scanned photos cannot be identified. They will all wait for review.
          </p>
        )}
      </section>

      {items.length > 0 && (
        <section className="card-surface p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <strong>{items.length} scanned</strong>
            <span className="text-green-700 dark:text-green-400">{counts.added ?? 0} added</span>
            <span className="text-blue-700 dark:text-blue-300">
              {counts.merged ?? 0} extra cop{(counts.merged ?? 0) === 1 ? "y" : "ies"}
            </span>
            <span className="text-amber-700 dark:text-amber-300">{needsReview.length} need review</span>
            {working > 0 && <span className="text-neutral-500">{working} in flight…</span>}
            {working === 0 && items.length > 0 && (
              <Link href="/collection" className="ml-auto underline decoration-dotted">
                View collection
              </Link>
            )}
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => (
              <li key={it.key} className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
                <div className="relative aspect-[3/4] bg-neutral-100 dark:bg-neutral-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.preview} alt="" className="h-full w-full object-cover" />
                  <span className={`badge absolute left-1.5 top-1.5 ${STATUS_STYLE[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                </div>
                <div className="p-2 text-xs">
                  {it.identification ? (
                    <>
                      <div className="truncate font-medium">{it.identification.name}</div>
                      <div className="truncate text-neutral-500">
                        {GAMES[it.identification.game as Game]}
                        {it.identification.set_name ? ` · ${it.identification.set_name}` : ""}
                      </div>
                    </>
                  ) : (
                    <div className="text-neutral-500">{STATUS_LABEL[it.status]}…</div>
                  )}
                  {it.message && <div className="mt-1 text-neutral-500">{it.message}</div>}
                  {it.cardId && (
                    <Link href={`/cards/${it.cardId}`} className="mt-1 inline-block underline decoration-dotted">
                      Open card
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {working === 0 && needsReview.length > 0 && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {needsReview.length} card{needsReview.length === 1 ? " needs" : "s need"} a closer look. Add{" "}
              {needsReview.length === 1 ? "it" : "them"} on the{" "}
              <Link href="/add" className="underline">
                one-at-a-time page
              </Link>
              , where you can correct the details before saving.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
