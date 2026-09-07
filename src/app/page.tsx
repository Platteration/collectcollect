import { allSnapshots, latestSnapshotsByCard, listCards } from "@/lib/cards";
import { allocationByGame, gradingVerdict, isReadyToGrade, outlookSeries, portfolioSeries, realizedReturn, totalReturn } from "@/lib/analytics";
import { imageSrc } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { Portfolio, type Holding, type Opportunity } from "@/components/Portfolio";
import type { PriceSnapshot } from "@/lib/types";
import { listSales } from "@/lib/sales";

export const dynamic = "force-dynamic";

const VERDICT_ORDER = { prime: 0, insufficient: 1, wait: 2, skip: 3 } as const;

export default function HomePage() {
  const cards = listCards();
  const snapshots = allSnapshots();
  const settings = getSettings();
  const latest = latestSnapshotsByCard();
  const points = portfolioSeries(cards, snapshots);

  const byCard = new Map<number, PriceSnapshot[]>();
  for (const s of snapshots) {
    const list = byCard.get(s.cardId);
    if (list) list.push(s);
    else byCard.set(s.cardId, [s]);
  }

  const detailOf = (c: (typeof cards)[number]) =>
    [c.setName, c.cardNumber ? `#${c.cardNumber}` : null, c.year].filter(Boolean).join(" · ") || "—";

  const opportunities: Opportunity[] = cards
    .filter((c) => !c.grade)
    .map((c) => {
      const assess = c.identification?.condition_assessment ?? null;
      const series = outlookSeries(byCard.get(c.id) ?? [], settings, assess?.estimated_grade_high ?? assess?.estimated_grade_low ?? null);
      const verdict = gradingVerdict(series);
      return {
        id: c.id,
        name: c.name,
        game: c.game,
        detail: detailOf(c),
        image: imageSrc(c),
        quantity: c.quantity,
        series,
        verdict,
        status: c.gradingStatus,
        ready: isReadyToGrade(series, verdict, settings),
      };
    })
    .filter((o) => o.series.length > 0)
    .sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      const order = VERDICT_ORDER[a.verdict.kind] - VERDICT_ORDER[b.verdict.kind];
      if (order !== 0) return order;
      return (b.series[b.series.length - 1]?.upside ?? 0) - (a.series[a.series.length - 1]?.upside ?? 0);
    });

  const holdings: Holding[] = cards
    .map((c) => {
      const s = latest.get(c.id)?.summary;
      return {
        id: c.id,
        name: c.name,
        detail: detailOf(c),
        image: imageSrc(c),
        copy: c.grade ? `${c.gradingCompany ?? "Graded"} ${c.grade}` : `Raw · ${c.condition}`,
        value: (s?.yourCopyValue ?? 0) * c.quantity,
      };
    })
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const valueOf = (c: (typeof cards)[number]) => latest.get(c.id)?.summary.yourCopyValue ?? null;
  const returns = totalReturn(cards, valueOf);
  const sales = listSales();
  const realized = realizedReturn(sales);
  const allocation = allocationByGame(cards, valueOf);

  let lastRefreshed: string | null = null;
  for (const s of latest.values()) if (!lastRefreshed || s.fetchedAt > lastRefreshed) lastRefreshed = s.fetchedAt;

  return (
    <Portfolio
      points={points}
      cardCount={cards.length}
      copyCount={cards.reduce((n, c) => n + c.quantity, 0)}
      pricedCount={cards.filter((c) => latest.get(c.id)?.summary.yourCopyValue).length}
      lastRefreshed={lastRefreshed}
      opportunities={opportunities}
      holdings={holdings}
      returns={returns}
      allocation={allocation}
      settings={settings}
      realized={realized}
      recentSales={sales.slice(0, 5).map((s) => ({
        id: s.id,
        cardId: s.cardId,
        name: s.cardName,
        detail: s.cardDetail,
        soldAt: s.soldAt,
        quantity: s.quantity,
        net: Math.round((s.unitPrice * s.quantity - s.fees) * 100) / 100,
        gain: s.unitCost === null ? null : Math.round((s.unitPrice * s.quantity - s.fees - s.unitCost * s.quantity) * 100) / 100,
      }))}
    />
  );
}
