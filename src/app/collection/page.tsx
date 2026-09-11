import Link from "next/link";
import { latestSnapshotsByCard, listCards, listLocations } from "@/lib/cards";
import { money } from "@/lib/format";
import { GAMES, GAME_IDS, has } from "@/lib/types";
import { CollectionGrid } from "@/components/CollectionGrid";
import { listSubmissions } from "@/lib/submissions";

export const dynamic = "force-dynamic";

export default async function CollectionPage({ searchParams }: PageProps<"/collection">) {
  const sp = await searchParams;
  const gameParam = has(GAMES, sp.game) ? sp.game : undefined;
  const q = typeof sp.q === "string" ? sp.q : "";
  // "none" selects cards with no location recorded, which is how you find what
  // still needs putting away.
  const locationParam = typeof sp.location === "string" ? sp.location : undefined;
  const cards = listCards({
    game: gameParam,
    search: q,
    location: locationParam === undefined ? undefined : locationParam === "none" ? "" : locationParam,
  });
  const locations = listLocations();
  const prices = latestSnapshotsByCard();

  const owned = cards.filter((c) => c.quantity > 0);
  let totalQty = 0;
  let totalValue = 0;
  let totalUngraded = 0;
  let priced = 0;
  for (const c of cards) {
    totalQty += c.quantity;
    const s = prices.get(c.id)?.summary;
    if (s?.yourCopyValue) {
      totalValue += s.yourCopyValue * c.quantity;
      if (c.quantity > 0) priced++;
    }
    if (s?.ungraded) totalUngraded += s.ungraded * c.quantity;
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cards" value={String(owned.length)} sub={`${totalQty} total copies${cards.length - owned.length ? ` · ${cards.length - owned.length} sold` : ""}`} />
        <Stat label="Collection value" value={money(totalValue)} sub={`${priced} of ${owned.length} priced`} />
        <Stat label="Ungraded value" value={money(totalUngraded)} sub="if every copy were raw NM" />
        <Stat
          label="Unpriced"
          value={String(Math.max(0, owned.length - priced))}
          sub={owned.length - priced ? "open a card and refresh prices" : "everything is priced"}
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
        <button className="btn-secondary" type="submit">
          Filter
        </button>
        {(q || gameParam || locationParam) && (
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

      {cards.length === 0 ? (
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
          cards={cards.map((c) => ({ card: c, price: prices.get(c.id)?.summary ?? null }))}
          locations={locations.map((l) => l.location)}
          drafts={listSubmissions()
            .filter((s) => s.status === "draft")
            .map((s) => ({ id: s.id, name: s.name, company: s.company }))}
        />
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
