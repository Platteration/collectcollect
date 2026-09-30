import { holdingsHistory } from "@collectcollect/core/holdings-history";
import { getDb } from "@/lib/db";
import { priceCoverage } from "@collectcollect/core/price-coverage";
import { thinPoints } from "@collectcollect/core/series";
import { costBasisByCard, latestSnapshotsByCard, listCards, recentSnapshotsByCard, snapshotValues } from "@/lib/cards";
import { OUTLOOK_SNAPSHOTS, allocationByGame, gradingVerdict, isReadyToGrade, outlookForChart, outlookSeries, portfolioSeries, realizedReturn, totalReturn } from "@/lib/analytics";
import { imageSrc } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { Portfolio, type Holding, type Opportunity } from "@/components/Portfolio";
import { listSales } from "@/lib/sales";

export const dynamic = "force-dynamic";

const VERDICT_ORDER = { prime: 0, insufficient: 1, wait: 2, skip: 3 } as const;

export default function HomePage() {
  // Cards with no copies left were sold; they keep their history but are not holdings.
  const cards = listCards().filter((c) => c.quantity > 0);
  const settings = getSettings();
  const latest = latestSnapshotsByCard();
  // A long history is thinned before it travels to the browser; the chart
  // thins what it shows again, so a short range keeps its detail. The series
  // is summed from two figures per snapshot, not from every summary parsed.
  const pricePoints = thinPoints(portfolioSeries(cards, snapshotValues()), 20_000);
  const history = holdingsHistory(getDb());
  const points = thinPoints(history.points, 20_000);
  // The outlook is drawn from each card's recent history, not its whole life.
  const recent = recentSnapshotsByCard(OUTLOOK_SNAPSHOTS);

  const detailOf = (c: (typeof cards)[number]) =>
    [c.setName, c.cardNumber ? `#${c.cardNumber}` : null, c.year].filter(Boolean).join(" · ") || "—";

  const opportunities: Opportunity[] = cards
    .filter((c) => !c.grade)
    .map((c) => {
      const assess = c.identification?.condition_assessment ?? null;
      const series = outlookSeries(recent.get(c.id) ?? [], settings, assess?.estimated_grade_high ?? assess?.estimated_grade_low ?? null);
      const verdict = gradingVerdict(series);
      return {
        id: c.id,
        name: c.name,
        game: c.game,
        detail: detailOf(c),
        image: imageSrc(c, "thumb"),
        quantity: c.quantity,
        // Verdict and readiness from every point; the browser gets what the chart needs.
        series: outlookForChart(series),
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
        image: imageSrc(c, "thumb"),
        copy: c.grade ? `${c.gradingCompany ?? "Graded"} ${c.grade}` : `Raw · ${c.condition}`,
        value: (s?.yourCopyValue ?? 0) * c.quantity,
      };
    })
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const valueOf = (c: (typeof cards)[number]) => latest.get(c.id)?.summary.yourCopyValue ?? null;
  const basis = costBasisByCard();
  const returns = totalReturn(cards, valueOf, (c) => basis.get(c.id));
  const sales = listSales();
  const realized = realizedReturn(sales);
  const allocation = allocationByGame(cards, valueOf);

  let lastRefreshed: string | null = null;
  for (const s of latest.values()) {
    const at = s.checkedAt ?? s.fetchedAt;
    if (!lastRefreshed || at > lastRefreshed) lastRefreshed = at;
  }

  return (
    <Portfolio
      points={points}
      pricePoints={pricePoints}
      historyStartedAt={history.startedAt}
      freshCount={priceCoverage(cards.map(c => ({ priced: latest.get(c.id)?.summary.yourCopyValue != null, fetchedAt: latest.get(c.id)?.checkedAt ?? latest.get(c.id)?.fetchedAt }))).fresh}
      cardCount={cards.length}
      copyCount={cards.reduce((n, c) => n + c.quantity, 0)}
      pricedCount={cards.filter((c) => latest.get(c.id)?.summary.yourCopyValue != null).length}
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
