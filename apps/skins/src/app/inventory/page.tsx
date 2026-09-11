import Link from "next/link";
import { money } from "@collectcollect/core/format";
import { latestSnapshotsByItem, listItems, listStorageUnits, type ListOptions } from "@/lib/items";
import { holdingValue } from "@/lib/valuation";
import { CATEGORIES, CATEGORY_IDS, EXTERIORS, EXTERIOR_IDS, RARITIES, RARITY_IDS, type Category, type Exterior, type Rarity } from "@/lib/types";
import { ItemTile } from "@/components/ItemTile";

export const dynamic = "force-dynamic";

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
  };
  const items = listItems(opts);
  const latest = latestSnapshotsByItem();
  const units = listStorageUnits();
  // An empty grid means two different things: nothing matched what was asked
  // for, or there is nothing at all yet. "Clear the filters" is useless advice
  // for the second, so it is only given for the first.
  const filtered = Object.values(opts).some((value) => value !== undefined && value !== "");

  const total = items.reduce((n, i) => n + (holdingValue(i, latest.get(i.id)) ?? 0), 0);
  const unpriced = items.filter((i) => holdingValue(i, latest.get(i.id)) === null).length;

  // Links keep whatever else is already narrowed down, so filters stack instead
  // of replacing one another.
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...flatten(params), ...patch })) {
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
          {items.length} item{items.length === 1 ? "" : "s"}
          {total > 0 && ` worth ${money(total)}`}
          {unpriced > 0 && `, ${unpriced} not priced`}
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
        {(["category", "exterior", "rarity", "stattrak", "locked", "unit"] as const).map((key) =>
          one(key) ? <input key={key} type="hidden" name={key} value={one(key)} /> : null,
        )}
        <button type="submit" className="btn-secondary">
          Search
        </button>
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
      className="badge border transition"
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
