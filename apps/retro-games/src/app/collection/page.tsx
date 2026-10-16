import { CollectionPage } from "@collectcollect/core/pages/CollectionPage";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: PageProps<"/collection">) {
  return <CollectionPage engine={engine} searchParams={await searchParams} />;
}
