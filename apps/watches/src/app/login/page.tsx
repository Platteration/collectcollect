import { LoginPage } from "@collectcollect/core/pages/LoginPage";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: PageProps<"/login">) {
  return <LoginPage engine={engine} searchParams={searchParams} />;
}
