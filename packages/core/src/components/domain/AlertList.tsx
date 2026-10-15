"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../api-client";
import { when } from "../../format";
import type { Alert } from "../../domain/spec";

export function AlertList({ alerts: initial, kinds }: { alerts: Alert[]; kinds: Record<string, { label: string; icon: string }> }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initial);
  const marked = useRef(false);
  const unread = initial.filter((a) => !a.readAt).length;

  // Seeing the list is the acknowledgement. Done once, then refresh so the
  // layout's unread badge recomputes.
  useEffect(() => {
    if (marked.current || unread === 0) return;
    marked.current = true;
    void api("/api/alerts", { method: "POST" })
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [unread, router]);

  const dismiss = async (id: number) => {
    setAlerts((all) => all.filter((a) => a.id !== id));
    await api(`/api/alerts/${id}`, { method: "DELETE" }).catch(() => undefined);
    router.refresh();
  };

  if (alerts.length === 0) {
    return (
      <p className="card-surface p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
        Nothing to report. Alerts appear here when a price moves enough to be worth acting on.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {alerts.map((alert) => (
        <li key={alert.id} className="card-surface flex items-start gap-3 p-3 text-sm" style={alert.readAt ? { opacity: 0.7 } : undefined}>
          <span aria-hidden className="mt-0.5 text-base leading-none">
            {kinds[alert.kind]?.icon ?? "•"}
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
              {kinds[alert.kind]?.label ?? alert.kind} · {when(alert.createdAt)}
              {!alert.readAt && " · unread"}
            </span>
          </span>
          <button type="button" className="shrink-0 rounded-md px-2 py-1 text-xs" style={{ color: "var(--muted)" }} onClick={() => dismiss(alert.id)} aria-label={`Dismiss: ${alert.title}`}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
