"use client";

import { useState } from "react";
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

export function AlertList({ alerts: initial, unreadIds }: { alerts: Alert[]; unreadIds: number[] }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initial);
  const unread = new Set(unreadIds);

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
