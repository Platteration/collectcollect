import { ItemPage } from "@collectcollect/core/pages/ItemPage";
import { engine } from "@/lib/engine";
import { watchExtras } from "@/components/WatchExtras";

export const dynamic = "force-dynamic";

export default function Page({ params }: PageProps<"/items/[id]">) {
  return <ItemPage engine={engine} params={params} extras={watchExtras} />;
}
