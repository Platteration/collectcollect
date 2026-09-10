import { SettingsPage } from "@collectcollect/core/pages/SettingsPage";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default function Page() {
  return <SettingsPage engine={engine} />;
}
