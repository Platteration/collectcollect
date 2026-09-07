"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { submissionOutcome } from "@/lib/analytics";
import { money, when } from "@/lib/format";
import { GRADING_STATUSES, SUBMISSION_STATUSES, type GradingStatus, type Submission } from "@/lib/types";

export interface Candidate {
  id: number;
  name: string;
  detail: string;
  raw: number | null;
  best: number | null;
  status: GradingStatus;
}

export function SubmissionDetail({ submission: initial, candidates }: { submission: Submission; candidates: Candidate[] }) {
  const router = useRouter();
  const [submission, setSubmission] = useState(initial);
  const [grades, setGrades] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outcome = submissionOutcome(submission);
  const editable = submission.status === "draft";

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ submission: Submission }>(`/api/submissions/${submission.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setSubmission(res.submission);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this submission? The cards stay in your collection.")) return;
    setBusy(true);
    try {
      await api(`/api/submissions/${submission.id}`, { method: "DELETE" });
      router.push("/submissions");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const filtered = candidates.filter((c) => !search.trim() || `${c.name} ${c.detail}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/submissions" className="text-sm text-neutral-500 underline">
            All submissions
          </Link>
          <h1 className="mt-1 font-display text-3xl font-semibold">{submission.name}</h1>
          <p className="text-sm text-neutral-500">
            {submission.company}
            {submission.serviceLevel ? ` · ${submission.serviceLevel}` : ""} · {money(submission.feePerCard)} per card
            {submission.shipping ? ` + ${money(submission.shipping)} shipping` : ""}
            {submission.sentAt ? ` · sent ${when(submission.sentAt)}` : ""}
            {submission.returnedAt ? ` · returned ${when(submission.returnedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100">
            {SUBMISSION_STATUSES[submission.status]}
          </span>
          <button type="button" className="btn-danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

      <section className="card-surface grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="Cards" value={String(outcome.cards)} />
        <Stat label="Cost" value={money(outcome.cost)} sub={`${money(submission.feePerCard)} × ${outcome.cards}${submission.shipping ? " + shipping" : ""}`} />
        <Stat label="Raw value in" value={money(outcome.rawValue)} sub="when added" />
        {outcome.gain === null ? (
          <Stat label="Best case out" value={money(outcome.expectedValue)} sub="every card gem mint" />
        ) : (
          <Stat
            label="Net after fees"
            value={`${outcome.gain >= 0 ? "+" : "−"}${money(Math.abs(outcome.gain))}`}
            sub={`${money(outcome.returnedValue)} back on ${outcome.graded} graded`}
            tone={outcome.gain >= 0 ? "up" : "down"}
          />
        )}
      </section>

      <section className="card-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Cards in this batch</h2>
          {submission.status === "draft" && submission.cards.length > 0 && (
            <button type="button" className="btn-primary" onClick={() => patch({ markSent: true })} disabled={busy}>
              Mark as sent
            </button>
          )}
          {submission.status === "sent" && (
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                patch({
                  results: Object.entries(grades)
                    .filter(([, g]) => g.trim())
                    .map(([cardId, grade]) => ({ cardId: Number(cardId), grade })),
                })
              }
              disabled={busy || Object.values(grades).every((g) => !g.trim())}
            >
              Record grades
            </button>
          )}
        </div>

        {submission.cards.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Nothing added yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-black/5 dark:divide-white/5">
            {submission.cards.map((c) => {
              const delta = c.returnedValue !== null && c.rawValue !== null ? c.returnedValue - c.rawValue - submission.feePerCard : null;
              return (
                <li key={c.cardId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/cards/${c.cardId}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-neutral-500">
                      {c.detail} · raw {money(c.rawValue)}
                      {c.expectedValue ? ` · gem mint ${money(c.expectedValue)}` : ""}
                    </div>
                  </div>
                  {submission.status === "sent" && !c.returnedGrade && (
                    <label className="flex items-center gap-2">
                      <span className="text-xs text-neutral-500">Grade</span>
                      <input
                        className="input w-24"
                        value={grades[c.cardId] ?? ""}
                        onChange={(e) => setGrades((g) => ({ ...g, [c.cardId]: e.target.value }))}
                        placeholder="9.5"
                        inputMode="decimal"
                      />
                    </label>
                  )}
                  {c.returnedGrade && (
                    <span className="badge bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100">
                      {submission.company} {c.returnedGrade}
                    </span>
                  )}
                  {c.returnedValue !== null && <span className="font-medium">{money(c.returnedValue)}</span>}
                  {delta !== null && (
                    <span className={`text-xs font-medium ${delta >= 0 ? "delta-up" : "delta-down"}`}>
                      {delta >= 0 ? "+" : "−"}
                      {money(Math.abs(delta))}
                    </span>
                  )}
                  {editable && (
                    <button type="button" className="text-xs text-neutral-500 underline" onClick={() => patch({ removeCardId: c.cardId })} disabled={busy}>
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editable && (
        <section className="card-surface p-4">
          <h2 className="font-semibold">Add raw cards</h2>
          <input className="input mt-2 max-w-sm" placeholder="Search your raw cards…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {filtered.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No raw cards left to add.</p>
          ) : (
            <ul className="mt-3 max-h-96 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
              {filtered.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-xs text-neutral-500">
                      {c.detail} · raw {money(c.raw)}
                      {c.best ? ` · gem mint ${money(c.best)}` : ""}
                      {c.status !== "undecided" ? ` · ${GRADING_STATUSES[c.status]}` : ""}
                    </div>
                  </div>
                  <button type="button" className="btn-secondary" onClick={() => patch({ addCardId: c.id })} disabled={busy}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`hero-figure text-2xl ${tone === "up" ? "delta-up" : tone === "down" ? "delta-down" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
