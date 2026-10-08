import { listAlerts } from "@/lib/alerts";
import { AlertList } from "@/components/AlertList";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const alerts = listAlerts();
  // Marking read is a write, so it happens from the client once the list is on
  // screen; that also refreshes the layout, which owns the unread badge.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Alerts</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Raised when prices are refreshed. What counts as worth telling you is
          set in Settings — the thresholds exist so this feed stays worth
          reading.
        </p>
      </header>
      <AlertList alerts={alerts} unreadIds={alerts.filter((a) => !a.readAt).map((a) => a.id)} />
    </div>
  );
}
