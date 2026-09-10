import { listAlerts } from "@/lib/alerts";
import { AlertList } from "@/components/AlertList";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
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
      <AlertList alerts={listAlerts()} />
    </div>
  );
}
