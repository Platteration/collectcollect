import { AddPage } from "@collectcollect/core/pages/AddPage";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default function Page() {
  return <AddPage engine={engine} />;
}
