import Link from "next/link";
import { latestSnapshotsByCard, listCards } from "@/lib/cards";
import { money } from "@/lib/format";
import { GAMES, GAME_IDS, type Game } from "@/lib/types";
import { CardTile } from "@/components/CardTile";

export const dynamic = "force-dynamic";

export default async function CollectionPage({ searchParams }: PageProps<"/collection">) {
  const sp = await searchParams;
  const gameParam = typeof sp.game === "string" && sp.game in GAMES ? (sp.game as Game) : undefined;
  const q = typeof sp.q === "string" ? sp.q : "";
  const cards = listCards({ game: gameParam, search: q });
  const prices = latestSnapshotsByCard();

  let totalQty = 0;
  let totalValue = 0;
  let totalUngraded = 0;
  let priced = 0;
  for (const c of cards) {
    totalQty += c.quantity;
    const s = prices.get(c.id)?.summary;
    if (s?.yourCopyValue) {
      totalValue += s.yourCopyValue * c.quantity;
      priced++;
    }
    if (s?.ungraded) totalUngraded += s.ungraded * c.quantity;
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cards" value={String(cards.length)} sub={`${totalQty} total copies`} />
        <Stat label="Collection value" value={money(totalValue)} sub={`${priced} of ${cards.length} priced`} />
        <Stat label="Ungraded value" value={money(totalUngraded)} sub="if every copy were raw NM" />
        <Stat
          label="Unpriced"
          value={String(cards.length - priced)}
          sub={cards.length - priced ? "open a card and refresh prices" : "everything is priced"}
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
        <button className="btn-secondary" type="submit">
          Filter
        </button>
        {(q || gameParam) && (
          <Link href="/collection" className="text-sm text-neutral-500 underline">
            Clear
          </Link>
        )}
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <CardTile key={c.id} card={c} price={prices.get(c.id)?.summary ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card-surface p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-neutral-500">{sub}</div>
    </div>
  );
}
