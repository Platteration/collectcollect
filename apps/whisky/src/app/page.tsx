import { PortfolioPage } from "@collectcollect/core/pages/PortfolioPage";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <PortfolioPage engine={engine} />;
}
