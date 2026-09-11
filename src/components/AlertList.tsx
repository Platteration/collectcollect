"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { when } from "@/lib/format";
import { ALERT_KINDS, has, label } from "@/lib/types";
import type { Alert, AlertKind } from "@/lib/types";

const KIND_STYLE: Record<AlertKind, string> = {
  ready_to_grade: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  price_move: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  graded_data: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
};

/** The neutral badge an alert kind this app never wrote falls back to. */
const UNKNOWN_KIND_STYLE = "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200";

/**
 * How one alert's kind is shown.
 *
 * `kind` is whatever its row holds: a restored database can carry anything, and
 * indexing either table with it directly reads straight off Object.prototype —
 * `KIND_LABEL["__proto__"]` is an object, which React refuses as a child, so
 * one row turns the only page these alerts can be dismissed from into a 500
 * with no way back through the app. The label falls back to the raw text so the
 * row can be seen and dismissed; the class does not, because a class is not
 * text and must never be spliced together out of one.
 */
export function alertBadge(kind: string): { label: string; className: string } {
  return { label: label(ALERT_KINDS, kind), className: has(KIND_STYLE, kind) ? KIND_STYLE[kind] : UNKNOWN_KIND_STYLE };
}

export function AlertList({ alerts: initial, unreadIds }: { alerts: Alert[]; unreadIds: number[] }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initial);
  const unread = new Set(unreadIds);
  const marked = useRef(false);

  // Seeing the list is the acknowledgement. Done once, then refresh so the
  // layout's unread badge recomputes.
  useEffect(() => {
    if (marked.current || unreadIds.length === 0) return;
    marked.current = true;
    void api("/api/alerts", { method: "POST" })
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [unreadIds, router]);

  const dismiss = async (id: number) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    try {
      await api(`/api/alerts/${id}`, { method: "DELETE" });
      router.refresh();
    } catch {
      router.refresh();
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

      {alerts.length === 0 ? (
        <div className="card-surface p-8 text-center text-sm text-neutral-500">
          Nothing yet. Alerts appear after a price refresh finds something worth mentioning.
        </div>
      ) : (
        <ul className="card-surface divide-y divide-black/5 dark:divide-white/5">
          {alerts.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-start gap-3 p-3 ${unread.has(a.id) ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
              <span className={`badge ${alertBadge(a.kind).className}`}>{alertBadge(a.kind).label}</span>
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
                <div className="text-xs text-neutral-500">{when(a.createdAt)}</div>
              </div>
              <button type="button" className="text-xs text-neutral-500 underline" onClick={() => dismiss(a.id)}>
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
