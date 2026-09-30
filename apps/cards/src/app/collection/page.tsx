import Link from "next/link";
import { CARD_SORTS, collectionTotals, countCards, isCardSort, latestValuesByCard, listCards, listLocations, type CardSort, type ListOptions } from "@/lib/cards";
import { money } from "@/lib/format";
import { GAMES, GAME_IDS, isGame } from "@/lib/types";
import { CollectionGrid } from "@/components/CollectionGrid";
import { tileCard } from "@/components/CardTile";
import { listSubmissions } from "@/lib/submissions";

export const dynamic = "force-dynamic";

/** Tiles per page: a thousand-card collection is not one page of tiles. */
export const PAGE_SIZE = 120;

const SORT_LABELS: Record<CardSort, string> = { updated: "Recently updated", name: "Name", value: "Value", added: "Recently added" };

export default async function CollectionPage({ searchParams }: PageProps<"/collection">) {
  const sp = await searchParams;
  const gameParam = isGame(sp.game) ? sp.game : undefined;
  const q = typeof sp.q === "string" ? sp.q : "";
  // "none" selects cards with no location recorded, which is how you find what
  // still needs putting away.
  const locationParam = typeof sp.location === "string" ? sp.location : undefined;
  const missingCost = sp.cost === "missing";
  const sort: CardSort = isCardSort(sp.sort) ? sp.sort : "updated";
  const filters: ListOptions = {
    game: gameParam,
    search: q,
    location: locationParam === undefined ? undefined : locationParam === "none" ? "" : locationParam,
    missingCost,
  };
  // The figures at the top are over everything the filter matches; the tiles
  // are one page of it, and each carries only what a tile draws.
  const total = countCards(filters);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number.parseInt(typeof sp.page === "string" ? sp.page : "", 10);
  const page = Math.min(pages, Math.max(1, Number.isFinite(requested) ? requested : 1));
  const cards = listCards({ ...filters, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const totals = collectionTotals(filters);
  const locations = listLocations();
  const prices = latestValuesByCard(cards.map((c) => c.id));

  const query = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: q || undefined, game: gameParam, location: locationParam, cost: missingCost ? "missing" : undefined, sort: sort === "updated" ? undefined : sort, ...overrides })) {
      if (value !== undefined) params.set(key, value);
    }
    const text = params.toString();
    return text ? `/collection?${text}` : "/collection";
  };

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cards" value={String(totals.owned)} sub={`${totals.copies} total copies${totals.cards - totals.owned ? ` · ${totals.cards - totals.owned} sold` : ""}`} />
        <Stat label="Collection value" value={money(totals.value)} sub={`${totals.priced} of ${totals.owned} priced`} />
        <Stat label="Ungraded value" value={money(totals.ungraded)} sub="if every copy were raw NM" />
        <Stat
          label="Unpriced"
          value={String(Math.max(0, totals.owned - totals.priced))}
          sub={totals.owned - totals.priced ? "open a card and refresh prices" : "everything is priced"}
        />
      </section>

      <form className="flex flex-wrap items-center gap-2" action="/collection">
        <input name="q" defaultValue={q} placeholder="Search name, set, number…" className="input max-w-xs" />
        <select name="game" defaultValue={gameParam ?? ""} className="input max-w-[12rem]">
          <option value="">All games</option>
          {GAME_IDS.map((g) => (
            <option key={g} value={g}>
              {GAMES[g]}
            </option>
          ))}
        </select>
        {locations.length > 0 && (
          <select name="location" defaultValue={locationParam ?? ""} className="input max-w-[14rem]" aria-label="Kept in">
            <option value="">Anywhere</option>
            {locations.map((l) => (
              <option key={l.location} value={l.location}>
                {l.location} ({l.cards})
              </option>
            ))}
            <option value="none">No location recorded</option>
          </select>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="cost" value="missing" defaultChecked={missingCost} /> Missing purchase costs</label>
        <select name="sort" defaultValue={sort} className="input max-w-[12rem]" aria-label="Sort by">
          {CARD_SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
        <button className="btn-secondary" type="submit">
          Filter
        </button>
        {(q || gameParam || locationParam || missingCost || sort !== "updated") && (
          <Link href="/collection" className="text-sm text-neutral-500 underline">
            Clear
          </Link>
        )}
        <a href="/api/export" className="btn-secondary ml-auto" download>
          Export CSV
        </a>
        <a href="/api/export?type=sales" className="btn-secondary" download>
          Sales CSV
        </a>
        <Link href="/import" className="btn-secondary">
          Import CSV
        </Link>
      </form>

      {missingCost && cards.length > 0 && <div className="card-surface flex flex-wrap gap-3 p-3 text-sm">{cards.map((card) => <Link key={card.id} href={`/cards/${card.id}#purchases`} className="underline">Record costs for {card.name}</Link>)}</div>}
      {cards.length === 0 && (q || gameParam || locationParam !== undefined || missingCost) ? (
        // A filter that matched nothing is not an empty collection, and must
        // not read as one: the way out is to clear it, not to add a card.
        <div className="card-surface flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-lg font-medium">Nothing matches</p>
          <p className="max-w-md text-sm text-neutral-500">No card matches that search or those filters.</p>
          <Link href="/collection" className="btn-secondary">
            Clear the filters
          </Link>
        </div>
      ) : cards.length === 0 ? (
        <div className="card-surface flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-lg font-medium">No cards yet</p>
          <p className="max-w-md text-sm text-neutral-500">
            Snap a photo of a card and CollectCollect will identify it, look up the going rate for raw and
            graded copies, and keep it in your collection.
          </p>
          <Link href="/add" className="btn-primary">
            Add your first card
          </Link>
        </div>
      ) : (
        <CollectionGrid
          cards={cards.map((c) => ({ card: tileCard(c), price: prices.get(c.id) ?? null }))}
          locations={locations.map((l) => l.location)}
          drafts={listSubmissions()
            .filter((s) => s.status === "draft")
            .map((s) => ({ id: s.id, name: s.name, company: s.company }))}
        />
      )}

      {pages > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
          {page > 1 ? <Link href={query({ page: page === 2 ? undefined : String(page - 1) })} className="btn-secondary">Previous</Link> : <span />}
          <span className="text-neutral-500">
            Page {page} of {pages} · {total} cards
          </span>
          {page < pages ? <Link href={query({ page: String(page + 1) })} className="btn-secondary">Next</Link> : <span />}
        </nav>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card-surface p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="hero-figure mt-1 text-3xl">{value}</div>
      <div className="text-xs text-neutral-500">{sub}</div>
    </div>
  );
}
