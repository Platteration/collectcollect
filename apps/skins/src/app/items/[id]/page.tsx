/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { money, when } from "@collectcollect/core/format";
import { getItem, isTradeLocked, listSnapshots } from "@/lib/items";
import { listLots } from "@/lib/acquisitions";
import { listSalesForItem } from "@/lib/sales";
import { valueOf } from "@/lib/valuation";
import { CATEGORIES, EXTERIORS, RARITIES } from "@/lib/types";
import { FloatBar } from "@/components/FloatBar";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: PageProps<"/items/[id]">) {
  const { id } = await params;
  const item = getItem(Number(id));
  if (!item) notFound();

  const snapshots = listSnapshots(item.id);
  const { value, basis } = valueOf(item, snapshots[0]);
  const lots = listLots(item.id);
  const sales = listSalesForItem(item.id);
  const rarity = item.rarity ? RARITIES[item.rarity] : null;
  const locked = isTradeLocked(item);

  return (
    <div
      className="reveal rarity-wash -mx-4 space-y-6 px-4 py-4 sm:mx-0 sm:rounded-xl sm:px-6"
      style={rarity ? ({ ["--rarity" as string]: rarity.color }) : undefined}
    >
      <nav className="text-xs" style={{ color: "var(--muted)" }}>
        <Link href="/inventory" className="hover:underline">
          Inventory
        </Link>
        {" / "}
        {CATEGORIES[item.category]}
      </nav>

      <header className="flex flex-wrap items-start gap-4">
        <div className="well flex h-32 w-44 shrink-0 items-center justify-center overflow-hidden rounded-lg">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" className="h-full w-full object-contain p-2" />
          ) : (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              No image
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold leading-tight">{item.marketHashName}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: "var(--muted)" }}>
            {rarity && (
              <span className="badge border" style={{ borderColor: rarity.color, color: "var(--foreground)" }}>
                <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: rarity.color }} />
                {rarity.label}
              </span>
            )}
            <span>{CATEGORIES[item.category]}</span>
            {item.exterior && <span>· {EXTERIORS[item.exterior]}</span>}
            {item.stattrak && <span>· StatTrak™</span>}
            {item.souvenir && <span>· Souvenir</span>}
            {item.collection && <span>· {item.collection}</span>}
          </p>
          <p className="hero-figure mt-3 text-4xl">{value === null ? "Not priced" : money(value)}</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {basis}
            {item.stackable && item.quantity !== 1 && value !== null && ` · ${money(value * item.quantity)} for ${item.quantity}`}
            {item.purchasePrice !== null && ` · paid ${money(item.purchasePrice)}`}
          </p>
          {locked && (
            <p className="mt-2 text-sm" style={{ color: "var(--chart-bad-text)" }}>
              Trade locked until {item.tradableAfter!.slice(0, 10)}. It cannot be sold anywhere until then, whatever it is
              worth.
            </p>
          )}
        </div>
      </header>

      {item.floatValue !== null && (
        <section className="card-surface p-4">
          <h2 className="label">Wear</h2>
          <FloatBar value={item.floatValue} />
          {item.paintSeed !== null && (
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Pattern {item.paintSeed}
              {item.paintIndex !== null && ` · paint index ${item.paintIndex}`}. The pattern decides how the finish landed
              on this particular object, which for some skins is worth more than the float.
            </p>
          )}
        </section>
      )}

      {item.stickers.length > 0 && (
        <section>
          <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">Stickers</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {item.stickers.map((s) => (
              <li key={s.slot} className="card-surface flex items-baseline justify-between gap-2 p-3 text-sm">
                <span>
                  <span className="block">{s.name}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    Slot {s.slot + 1}
                  </span>
                </span>
                <span className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                  {s.wear === null ? "wear unknown" : s.wear === 0 ? "unscraped" : `${Math.round(s.wear * 100)}% scraped`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {item.storageUnit && <Fact label="Kept in" value={item.storageUnit} />}
        {item.nameTag && <Fact label="Named" value={`“${item.nameTag}”`} />}
        {item.assetId && <Fact label="Asset id" value={item.assetId} />}
        <Fact label="Added" value={when(item.createdAt)} />
      </dl>

      {item.notes && (
        <section>
          <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">Notes</h2>
          <p className="whitespace-pre-wrap text-sm">{item.notes}</p>
        </section>
      )}

      {lots.length > 0 && (
        <section>
          <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">Purchases</h2>
          <Table
            headers={["Acquired", "Copies", "Left", "Cost each", "From"]}
            rows={lots.map((lot) => [
              lot.acquiredAt.slice(0, 10),
              String(lot.quantity),
              String(lot.remaining),
              // Not knowing what a copy cost is a different thing from it being
              // free, and the table has to keep them apart.
              lot.unitCost === null ? "not recorded" : money(lot.unitCost),
              lot.source ?? "—",
            ])}
          />
        </section>
      )}

      {sales.length > 0 && (
        <section>
          <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">Sales</h2>
          <Table
            headers={["Sold", "Copies", "Each", "Fees", "Cost each", "Where"]}
            rows={sales.map((s) => [
              s.soldAt.slice(0, 10),
              String(s.quantity),
              money(s.unitPrice),
              money(s.fees),
              s.unitCost === null ? "not recorded" : money(s.unitCost),
              s.venue ?? "—",
            ])}
          />
        </section>
      )}

      {snapshots.length > 0 && (
        <section>
          <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">Value history</h2>
          <Table
            headers={["Date", "Your copy", "Market", "Basis"]}
            rows={snapshots.map((s) => [
              s.fetchedAt.slice(0, 10),
              s.summary.yourCopyValue === null ? "—" : money(s.summary.yourCopyValue),
              s.summary.market === null ? "—" : money(s.summary.market),
              s.summary.yourCopyBasis || "—",
            ])}
          />
        </section>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface p-3">
      <dt className="label mb-0.5">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: "var(--muted)" }}>
            {headers.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t" style={{ borderColor: "var(--line)" }}>
              {row.map((cell, j) => (
                <td key={j} className="whitespace-nowrap px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
