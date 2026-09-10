import { notFound } from "next/navigation";
import { getCard, listSnapshots } from "@/lib/cards";
import { CardDetail } from "@/components/CardDetail";
import { getSettings } from "@/lib/settings";
import { listSalesForCard } from "@/lib/sales";
import { listLots } from "@/lib/acquisitions";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: PageProps<"/cards/[id]">) {
  const { id } = await params;
  const n = Number(id);
  const card = Number.isInteger(n) ? getCard(n) : null;
  if (!card) notFound();
  const history = listSnapshots(card.id);
  return <CardDetail card={card} latest={history[0]?.summary ?? null} history={history} settings={getSettings()} sales={listSalesForCard(card.id)}
      acquisitions={listLots(card.id)} />;
}
