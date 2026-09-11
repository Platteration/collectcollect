"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { when } from "@/lib/format";
import type { Alert, AlertKind } from "@/lib/types";

const KIND_LABEL: Record<AlertKind, string> = {
  ready_to_grade: "Ready to grade",
  price_move: "Price move",
  graded_data: "Graded data",
};

const KIND_STYLE: Record<AlertKind, string> = {
  ready_to_grade: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  price_move: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  graded_data: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
};

/**
 * The feed. Seeing it is the acknowledgement, and dismissing is optimistic —
 * but a refusal from the server is said on the page and the row put back,
 * because an alert that comes back on the next visit reads as the app not
 * listening.
 */
export function AlertList({ alerts: initial, unreadIds }: { alerts: Alert[]; unreadIds: number[] }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const unread = new Set(unreadIds);
  const marked = useRef(false);

  // Seeing the list is the acknowledgement. Done once, then refresh so the
  // layout's unread badge recomputes.
  useEffect(() => {
    if (marked.current || unreadIds.length === 0) return;
    marked.current = true;
    void api("/api/alerts", { method: "POST" })
      .then(() => router.refresh())
      .catch((e: Error) => setError(`Could not mark these read: ${e.message}`));
  }, [unreadIds, router]);

  const dismiss = async (alert: Alert) => {
    setError(null);
    setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    try {
      await api(`/api/alerts/${alert.id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setAlerts((prev) => (prev.some((a) => a.id === alert.id) ? prev : [...prev, alert].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)));
      setError(`Could not dismiss "${alert.title}": ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Alerts</h1>
        <p className="text-sm text-neutral-500">
          Raised when prices refresh: a card crossing your ready-to-grade thresholds, a move bigger than the percentage
          in Settings, or real graded sales appearing where the app had only an estimate.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200" role="alert">
          {error}
        </p>
      )}

      {alerts.length === 0 ? (
        <div className="card-surface p-8 text-center text-sm text-neutral-500">
          Nothing yet. Alerts appear after a price refresh finds something worth mentioning.
        </div>
      ) : (
        <ul className="card-surface divide-y divide-black/5 dark:divide-white/5">
          {alerts.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-start gap-3 p-3 ${unread.has(a.id) ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
              <span className={`badge ${KIND_STYLE[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {a.cardId ? (
                    <Link href={`/cards/${a.cardId}`} className="hover:underline">
                      {a.title}
                    </Link>
                  ) : (
                    a.title
                  )}
                </div>
                <div className="text-sm text-neutral-600 dark:text-neutral-300">{a.body}</div>
                <div className="text-xs text-neutral-500">
                  {when(a.createdAt)}
                  {/* The tint says it; this says it to a screen reader and to print. */}
                  {unread.has(a.id) && " · unread"}
                </div>
              </div>
              <button type="button" className="text-xs text-neutral-500 underline" onClick={() => dismiss(a)} aria-label={`Dismiss: ${a.title}`}>
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
