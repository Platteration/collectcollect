import { AlertsPage } from "@collectcollect/core/pages/AlertsPage";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default function Page() {
  return <AlertsPage engine={engine} />;
}
