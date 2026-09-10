import { listAlerts } from "@/lib/alerts";
import { AlertList } from "@/components/AlertList";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const alerts = listAlerts();
  // Marking read is a write, so it happens from the client once the list is on
  // screen; that also refreshes the layout, which owns the unread badge.
  return <AlertList alerts={alerts} unreadIds={alerts.filter((a) => !a.readAt).map((a) => a.id)} />;
}
