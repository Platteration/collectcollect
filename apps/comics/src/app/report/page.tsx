import { ReportPage } from "@collectcollect/core/pages/ReportPage";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: PageProps<"/report">) {
  return <ReportPage engine={engine} searchParams={await searchParams} />;
}
