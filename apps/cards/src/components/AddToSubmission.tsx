"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { Submission } from "@/lib/types";

/**
 * Put a raw card into a grading batch from wherever the card is being looked
 * at, rather than only from the batch's own page.
 *
 * The drafts are fetched when the chooser opens, not when the button renders:
 * the portfolio draws one of these per ready card, and a request each would
 * be a small storm for a list nobody has clicked on.
 */
export function AddToSubmission({ cardId, compact = false }: { cardId: number; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Submission[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openChooser = async () => {
    setOpen(true);
    setError(null);
    if (drafts) return;
    try {
      const body = await api<{ submissions: Submission[] }>("/api/submissions");
      const open = body.submissions.filter((s) => s.status === "draft");
      setDrafts(open);
      setChosen(open[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
      setDrafts([]);
    }
  };

  const add = async () => {
    if (chosen === null) return;
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ submission: Submission }>(`/api/submissions/${chosen}`, {
        method: "PATCH",
        body: JSON.stringify({ addCardId: cardId }),
      });
      setDone(body.submission.name);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className={`text-green-800 dark:text-green-300 ${compact ? "text-xs" : "text-sm"}`}>
        Added to{" "}
        <Link href="/submissions" className="underline">
          {done}
        </Link>
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className={compact ? "text-xs underline decoration-dotted" : "btn-secondary"} onClick={openChooser}>
        Add to a submission
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      {drafts === null ? (
        <span className="text-neutral-500">Loading…</span>
      ) : drafts.length === 0 ? (
        <>
          <span className="text-neutral-500">No open batch yet.</span>
          <Link href="/submissions" className="underline">
            Start a submission
          </Link>
        </>
      ) : (
        <>
          <label className="sr-only" htmlFor={`submission-for-${cardId}`}>
            Submission
          </label>
          <select
            id={`submission-for-${cardId}`}
            className="input max-w-[14rem]"
            value={chosen ?? ""}
            onChange={(e) => setChosen(Number(e.target.value))}
          >
            {drafts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.cards.length} card{s.cards.length === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={add} disabled={busy || chosen === null}>
            {busy ? "Adding…" : "Add"}
          </button>
        </>
      )}
      <button type="button" className="text-xs text-neutral-500 underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && (
        <span className="text-red-700 dark:text-red-300" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
