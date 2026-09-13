"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import { when } from "@collectcollect/core/format";
import type { Alert, AlertKind } from "@/lib/types";

const KINDS: Record<AlertKind, { label: string; icon: string }> = {
  price_move: { label: "Price move", icon: "↕" },
  spread_opened: { label: "Worth more elsewhere", icon: "⇄" },
  trade_lock_lifted: { label: "Trade lock ended", icon: "🔓" },
};

/**
 * The feed, and what can be done to it.
 *
 * Seeing the list is the acknowledgement, as on the card app: the unread rows
 * are marked read once the page is on screen, and the layout's badge clears.
 * Dismissing is optimistic — the row goes at once — and is undone on the page
 * if the server refuses, with the refusal said out loud. A dismiss that failed
 * silently would leave an alert that comes back on the next visit, which reads
 * as the app not listening.
 */
export function AlertList({ alerts: initial, unreadIds }: { alerts: Alert[]; unreadIds: number[] }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const unread = new Set(unreadIds);
  const marked = useRef(false);

  useEffect(() => {
    if (marked.current || unreadIds.length === 0) return;
    marked.current = true;
    void api("/api/alerts", { method: "POST" })
      .then(() => router.refresh())
      .catch((e: Error) => setError(`Could not mark these read: ${e.message}`));
  }, [unreadIds, router]);

  const dismiss = async (alert: Alert) => {
    setError(null);
    setAlerts((all) => all.filter((a) => a.id !== alert.id));
    try {
      await api(`/api/alerts/${alert.id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      // Put it back where it was, so the list matches what the server holds.
      setAlerts((all) => (all.some((a) => a.id === alert.id) ? all : [...all, alert].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)));
      setError(`Could not dismiss "${alert.title}": ${(e as Error).message}`);
    }
  };

  if (alerts.length === 0) {
    return (
      <p className="card-surface p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
        Nothing to report. Alerts appear here when something moves enough to be
        worth acting on, when a market starts paying meaningfully more than
        another, or when a trade lock ends.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="card-surface p-3 text-sm" style={{ color: "var(--chart-bad-text)" }} role="alert">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {alerts.map((alert) => (
          <li
            key={alert.id}
            className="card-surface flex items-start gap-3 p-3 text-sm"
            style={unread.has(alert.id) ? undefined : { opacity: 0.6 }}
          >
            <span aria-hidden className="mt-0.5 text-base leading-none">
              {KINDS[alert.kind]?.icon ?? "•"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">
                {alert.itemId ? (
                  <Link href={`/items/${alert.itemId}`} className="hover:underline">
                    {alert.title}
                  </Link>
                ) : (
                  alert.title
                )}
              </span>
              <span className="block" style={{ color: "var(--muted)" }}>
                {alert.body}
              </span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
                {KINDS[alert.kind]?.label ?? alert.kind} · {when(alert.createdAt)}
                {/* Marked read on sight; the word stays for this visit, so a screen reader hears what was new. */}
                {unread.has(alert.id) && " · unread"}
              </span>
            </span>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-xs"
              style={{ color: "var(--muted)" }}
              onClick={() => dismiss(alert)}
              aria-label={`Dismiss: ${alert.title}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
