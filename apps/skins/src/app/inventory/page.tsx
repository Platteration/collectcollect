import Link from "next/link";
import { money } from "@collectcollect/core/format";
import { ITEM_SORTS, countItems, inventoryTotals, isItemSort, latestSnapshotsByItem, listItems, listStorageUnits, type ItemSort, type ListOptions } from "@/lib/items";
import { holdingValue } from "@/lib/valuation";
import { CATEGORIES, CATEGORY_IDS, EXTERIORS, EXTERIOR_IDS, RARITIES, RARITY_IDS, type Category, type Exterior, type Rarity } from "@/lib/types";
import { ItemTile } from "@/components/ItemTile";

export const dynamic = "force-dynamic";

/** Tiles per page: a thousand-item inventory is not one page of tiles. */
export const PAGE_SIZE = 120;

const SORT_LABELS: Record<ItemSort, string> = { updated: "Recently updated", name: "Name", value: "Value", added: "Recently added" };

/** Only a value the app knows survives into a query; anything else is dropped. */
function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const opts: ListOptions = {
    category: pick<Category>(one("category"), CATEGORY_IDS),
    exterior: pick<Exterior>(one("exterior"), EXTERIOR_IDS),
    rarity: pick<Rarity>(one("rarity"), RARITY_IDS),
    stattrak: one("stattrak") === "1" ? true : undefined,
    lockedOnly: one("locked") === "1" ? true : undefined,
    search: one("q") ?? undefined,
    storageUnit: one("unit"),
    missingCost: one("cost") === "missing" ? true : undefined,
  };
  const missingCost = opts.missingCost === true;
  const sort: ItemSort = isItemSort(one("sort")) ? (one("sort") as ItemSort) : "updated";
  // The figures at the top are over everything the filter matches; the tiles
  // are one page of it.
  const total = countItems(opts);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number.parseInt(one("page") ?? "", 10);
  const page = Math.min(pages, Math.max(1, Number.isFinite(requested) ? requested : 1));
  const items = listItems({ ...opts, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const totals = inventoryTotals(opts);
  const latest = latestSnapshotsByItem();
  const units = listStorageUnits();
  // An empty grid means two different things: nothing matched what was asked
  // for, or there is nothing at all yet. "Clear the filters" is useless advice
  // for the second, so it is only given for the first.
  const filtered = Object.values(opts).some((value) => value !== undefined && value !== "");

  // Links keep whatever else is already narrowed down, so filters stack instead
  // of replacing one another; a change of filter starts again at the first page.
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...flatten(params), page: undefined, ...patch })) {
      if (value) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/inventory?${query}` : "/inventory";
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Inventory</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {totals.items} item{totals.items === 1 ? "" : "s"}
          {totals.value > 0 && ` worth ${money(totals.value)}`}
          {totals.unpriced > 0 && `, ${totals.unpriced} not priced`}
        </p>
      </header>

      <form className="flex flex-wrap gap-2" action="/inventory">
        <input
          className="input max-w-xs"
          type="search"
          name="q"
          defaultValue={one("q") ?? ""}
          placeholder="Search names, finishes, collections…"
          aria-label="Search the inventory"
        />
        {/* Searching must not silently drop the filters already applied. */}
        {(["category", "exterior", "rarity", "stattrak", "locked", "unit", "cost"] as const).map((key) =>
          one(key) ? <input key={key} type="hidden" name={key} value={one(key)} /> : null,
        )}
        <select name="sort" defaultValue={sort} className="input max-w-[12rem]" aria-label="Sort by">
          {ITEM_SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">
          Search
        </button>
        <a href="/api/export" className="btn-secondary ml-auto" download>
          Export CSV
        </a>
        <a href="/api/export?type=sales" className="btn-secondary" download>
          Sales CSV
        </a>
      </form>

      {/* A landmark rather than a loose pile of links: it gives the filters a
          name to be skipped to, and a boundary between them and the grid. */}
      <nav aria-label="Filters" className="space-y-2 text-sm">
        <FilterRow label="Kind">
          {CATEGORY_IDS.map((id) => (
            <Chip key={id} href={href({ category: opts.category === id ? undefined : id })} on={opts.category === id}>
              {CATEGORIES[id]}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Wear">
          {EXTERIOR_IDS.map((id) => (
            <Chip key={id} href={href({ exterior: opts.exterior === id ? undefined : id })} on={opts.exterior === id}>
              {EXTERIORS[id]}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Rarity">
          {RARITY_IDS.map((id) => (
            <Chip key={id} href={href({ rarity: opts.rarity === id ? undefined : id })} on={opts.rarity === id} color={RARITIES[id].color}>
              {RARITIES[id].label}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Other">
          <Chip href={href({ cost: missingCost ? undefined : "missing" })} on={missingCost}>Missing purchase costs</Chip>
          <Chip href={href({ stattrak: opts.stattrak ? undefined : "1" })} on={Boolean(opts.stattrak)}>
            StatTrak™
          </Chip>
          <Chip href={href({ locked: opts.lockedOnly ? undefined : "1" })} on={Boolean(opts.lockedOnly)}>
            Trade locked
          </Chip>
          {units.map((u) => (
            <Chip key={u.storageUnit} href={href({ unit: opts.storageUnit === u.storageUnit ? undefined : u.storageUnit })} on={opts.storageUnit === u.storageUnit}>
              {u.storageUnit} ({u.items})
            </Chip>
          ))}
        </FilterRow>
      </nav>

      {missingCost && items.length > 0 && <div className="card-surface flex flex-wrap gap-3 p-3 text-sm">{items.map((item) => <Link key={item.id} href={`/items/${item.id}#purchases`} className="underline">Record costs for {item.marketHashName}</Link>)}</div>}
      {items.length === 0 && !filtered ? (
        <section className="card-surface p-6 text-center">
          <p className="font-display text-lg font-semibold">Nothing here yet</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Bring in a whole inventory from Steam or a spreadsheet, or add one item by hand.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/import" className="btn-primary">
              Import an inventory
            </Link>
            <Link href="/add" className="btn-secondary">
              Add an item
            </Link>
          </div>
        </section>
      ) : items.length === 0 ? (
        <p className="card-surface p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          Nothing matches. <Link href="/inventory" className="underline">Clear the filters</Link> to see everything.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id} className="contents">
              <ItemTile item={item} value={holdingValue(item, latest.get(item.id))} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
          {page > 1 ? <Link href={href({ sort: sort === "updated" ? undefined : sort, page: page === 2 ? undefined : String(page - 1) })} className="btn-secondary">Previous</Link> : <span />}
          <span style={{ color: "var(--muted)" }}>
            Page {page} of {pages} · {total} items
          </span>
          {page < pages ? <Link href={href({ sort: sort === "updated" ? undefined : sort, page: String(page + 1) })} className="btn-secondary">Next</Link> : <span />}
        </nav>
      )}
    </div>
  );
}

function flatten(params: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) out[key] = Array.isArray(value) ? value[0] : value;
  return out;
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="label mb-0 w-14 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function Chip({ href, on, color, children }: { href: string; on: boolean; color?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      className="badge inline-flex min-h-9 items-center border px-3 transition"
      style={{
        borderColor: on ? "var(--line-strong)" : "var(--line)",
        background: on ? "var(--surface-raised)" : "transparent",
        color: on ? "var(--foreground)" : "var(--muted)",
      }}
    >
      {color && <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </Link>
  );
}
