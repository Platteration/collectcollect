import { ImportPage } from "@collectcollect/core/pages/ImportPage";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default function Page() {
  return <ImportPage engine={engine} />;
}
