import { listAlerts, markAllRead } from "@/lib/alerts";
import { AlertList } from "@/components/AlertList";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const alerts = listAlerts();
  // Opening the page is the acknowledgement; the list still marks which were new.
  const wasUnread = new Set(alerts.filter((a) => !a.readAt).map((a) => a.id));
  markAllRead();
  return <AlertList alerts={alerts} unreadIds={[...wasUnread]} />;
}
