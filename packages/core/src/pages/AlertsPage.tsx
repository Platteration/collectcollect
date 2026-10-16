import type { Engine } from "../domain/engine";
import { BASE_ALERT_KINDS } from "../domain/alerts";
import { AlertList } from "../components/domain/AlertList";
import { Heading } from "./shared";

export function AlertsPage<F extends object, S extends object, X extends object, Q>({ engine }: { engine: Engine<F, S, X, Q> }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Heading title="Alerts" note="Raised when prices are refreshed. What counts as worth telling you about is set in Settings, so this feed stays worth reading." />
      <AlertList alerts={engine.alerts.listAlerts()} kinds={{ ...BASE_ALERT_KINDS, ...(engine.spec.alerts?.kinds ?? {}) }} />
    </div>
  );
}
