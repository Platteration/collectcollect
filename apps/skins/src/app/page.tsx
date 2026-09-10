import { allSnapshots, costBasisByItem, isTradeLocked, latestSnapshotsByItem, listItems } from "@/lib/items";
import { allocationBy, portfolioSeries, realizedReturn, totalReturn } from "@/lib/analytics";
import { listSales } from "@/lib/sales";
import { valueOf } from "@/lib/valuation";
import { CATEGORIES, EXTERIORS } from "@/lib/types";
import { Portfolio, type Holding } from "@/components/Portfolio";

export const dynamic = "force-dynamic";

export default function HomePage() {
  // Items with no copies left were sold; they keep their history but are not holdings.
  const items = listItems().filter((i) => i.quantity > 0);
  const snapshots = allSnapshots();
  const latest = latestSnapshotsByItem();
  const points = portfolioSeries(items, snapshots);
  const priceOf = (item: (typeof items)[number]) => valueOf(item, latest.get(item.id)).value;

  const detailOf = (item: (typeof items)[number]) =>
    [
      CATEGORIES[item.category],
      item.exterior ? EXTERIORS[item.exterior] : null,
      item.floatValue === null ? null : `float ${Number(item.floatValue.toFixed(6))}`,
    ]
      .filter(Boolean)
      .join(" · ") || "—";

  const holdings: Holding[] = items
    .map((item) => ({
      id: item.id,
      name: item.marketHashName,
      detail: detailOf(item),
      image: item.imageUrl,
      rarity: item.rarity,
      quantity: item.quantity,
      stackable: item.stackable,
      value: (priceOf(item) ?? 0) * item.quantity,
    }))
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const basis = costBasisByItem();
  const returns = totalReturn(items, priceOf, (item) => basis.get(item.id));
  const sales = listSales();
  const realized = realizedReturn(sales);

  let lastRefreshed: string | null = null;
  for (const s of latest.values()) if (!lastRefreshed || s.fetchedAt > lastRefreshed) lastRefreshed = s.fetchedAt;

  return (
    <Portfolio
      points={points}
      itemCount={items.length}
      copyCount={items.reduce((n, i) => n + i.quantity, 0)}
      pricedCount={items.filter((i) => priceOf(i) !== null).length}
      lockedCount={items.filter((i) => isTradeLocked(i)).length}
      lastRefreshed={lastRefreshed}
      holdings={holdings}
      returns={returns}
      byCategory={allocationBy(items, (i) => i.category, priceOf)}
      byRarity={allocationBy(items, (i) => i.rarity, priceOf)}
      realized={realized}
      recentSales={sales.slice(0, 5).map((s) => ({
        id: s.id,
        itemId: s.itemId,
        name: s.itemName,
        detail: s.itemDetail,
        soldAt: s.soldAt,
        quantity: s.quantity,
        net: Math.round((s.unitPrice * s.quantity - s.fees) * 100) / 100,
        gain: s.unitCost === null ? null : Math.round((s.unitPrice * s.quantity - s.fees - s.unitCost * s.quantity) * 100) / 100,
      }))}
    />
  );
}
