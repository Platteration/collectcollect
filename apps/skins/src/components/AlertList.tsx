"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@collectcollect/core/api-client";
import { when } from "@collectcollect/core/format";
import type { Alert, AlertKind } from "@/lib/types";

const KINDS: Record<AlertKind, { label: string; icon: string }> = {
  price_move: { label: "Price move", icon: "↕" },
  spread_opened: { label: "Worth more elsewhere", icon: "⇄" },
  trade_lock_lifted: { label: "Trade lock ended", icon: "🔓" },
};

export function AlertList({ alerts: initial }: { alerts: Alert[] }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initial);
  const [busy, setBusy] = useState(false);

  const readAll = async () => {
    setBusy(true);
    try {
      await api("/api/alerts", { method: "POST" });
      setAlerts((all) => all.map((a) => ({ ...a, readAt: a.readAt ?? new Date().toISOString() })));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (id: number) => {
    setAlerts((all) => all.filter((a) => a.id !== id));
    await api(`/api/alerts/${id}`, { method: "DELETE" }).catch(() => undefined);
    router.refresh();
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

  const unread = alerts.filter((a) => !a.readAt).length;

  return (
    <div className="space-y-3">
      {unread > 0 && (
        <button type="button" className="btn-secondary" onClick={readAll} disabled={busy}>
          Mark all {unread} read
        </button>
      )}
      <ul className="space-y-2">
        {alerts.map((alert) => (
          <li
            key={alert.id}
            className="card-surface flex items-start gap-3 p-3 text-sm"
            style={alert.readAt ? { opacity: 0.6 } : undefined}
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
                {!alert.readAt && " · unread"}
              </span>
            </span>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-xs"
              style={{ color: "var(--muted)" }}
              onClick={() => dismiss(alert.id)}
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
