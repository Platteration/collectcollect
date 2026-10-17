import { OfflinePage } from "@collectcollect/core/components/OfflinePage";
import { engine } from "@/lib/engine";

export const metadata = { title: "Offline" };

export default function Offline() {
  return <OfflinePage thing={engine.spec.noun.plural} />;
}
