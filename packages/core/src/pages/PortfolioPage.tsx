import { allocationBy, portfolioSeries, realizedReturn, totalReturn } from "../domain/analytics";
import type { Engine } from "../domain/engine";
import type { ItemRecord } from "../domain/spec";
import { Portfolio, type AllocationView, type Holding } from "../components/domain/Portfolio";
import { imageOf } from "./shared";

/**
 * The dashboard: what the collection is worth now, how that moved, what it
 * cost, what selling has banked, the biggest holdings and where the value
 * sits. Every figure comes through the engine, so it is right for whatever
 * the app collects.
 */
export function PortfolioPage<F extends object, S extends object, X extends object, Q>({ engine, children }: { engine: Engine<F, S, X, Q>; children?: React.ReactNode }) {
  const { spec, repo } = engine;
  const everything = repo.listItems().filter((i) => i.quantity > 0);
  // What counts: copies still held that the domain does not set aside (an opened bottle, say).
  const items = everything.filter((i) => engine.counts(i));
  const excluded = everything.length - items.length;
  const latest = repo.latestSnapshotsByItem();
  const snapshots = repo.allSnapshots();
  const points = portfolioSeries(items, snapshots);
  const priceOf = (item: ItemRecord<F>) => engine.valuation(item, latest.get(item.id)).value;

  const holdings: Holding[] = items
    .map((item) => ({
      id: item.id,
      title: spec.title(item),
      detail: spec.detail(item),
      condition: spec.conditionLabel(item),
      image: imageOf(item),
      quantity: item.quantity,
      unique: spec.isUnique(item),
      value: (priceOf(item) ?? 0) * item.quantity,
    }))
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const basis = engine.ledger.costBasisByItem();
  const returns = totalReturn(items, priceOf, (item) => basis.get(item.id));
  const sales = engine.sales.listSales();
  const realized = realizedReturn(sales);

  const allocations: AllocationView[] = (spec.allocations ?? []).map((a) => {
    const split = allocationBy(items, a.keyOf, priceOf);
    return {
      id: a.id,
      label: a.label,
      rows: split.rows.map((r) => ({ ...r, label: a.labelOf ? a.labelOf(r.key) : r.key, color: a.color?.(r.key) ?? null })),
      unclassified: split.unclassified,
      unclassifiedShare: split.unclassifiedShare,
      unclassifiedNote: a.unclassifiedNote ?? `no ${a.label.toLowerCase()} recorded`,
    };
  });

  let lastRefreshed: string | null = null;
  for (const s of latest.values()) if (!lastRefreshed || s.fetchedAt > lastRefreshed) lastRefreshed = s.fetchedAt;

  return (
    <Portfolio
      noun={spec.noun}
      points={points}
      itemCount={items.length}
      copyCount={items.reduce((n, i) => n + i.quantity, 0)}
      pricedCount={items.filter((i) => priceOf(i) !== null).length}
      excludedCount={excluded}
      excludedNote={spec.excludedNote}
      lastRefreshed={lastRefreshed}
      holdings={holdings}
      returns={returns}
      allocations={allocations}
      realized={realized}
      recentSales={sales.slice(0, 5).map((s) => ({
        id: s.id,
        itemId: s.itemId,
        title: s.itemName,
        detail: s.itemDetail,
        soldAt: s.soldAt,
        quantity: s.quantity,
        net: Math.round((s.unitPrice * s.quantity - s.fees) * 100) / 100,
        gain: s.unitCost === null ? null : Math.round((s.unitPrice * s.quantity - s.fees - s.unitCost * s.quantity) * 100) / 100,
      }))}
      emptyNote={spec.emptyNote ?? `Add a ${spec.noun.singular} by photographing it or filling in the form, or import a spreadsheet. Prices, the chart and the report follow from there.`}
      hasSeed={Boolean(spec.seed?.length)}
    >
      {children}
    </Portfolio>
  );
}
