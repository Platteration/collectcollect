import Link from "next/link";
import { notFound } from "next/navigation";
import { latestSnapshotsByCard } from "@/lib/cards";
import { httpUrl, money } from "@/lib/format";
import { setDetail } from "@/lib/sets";
import { GAMES, type Game } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SetPage({ params }: PageProps<"/sets/[game]/[name]">) {
  const { game, name } = await params;
  if (!(game in GAMES)) notFound();
  const setName = decodeURIComponent(name);
  const { owned, checklist, have } = setDetail(game as Game, setName);
  if (owned.length === 0 && !checklist) notFound();

  const prices = latestSnapshotsByCard();
  const ownedValue = owned.reduce((n, c) => n + (prices.get(c.id)?.summary.yourCopyValue ?? 0) * c.quantity, 0);
  const missing = checklist ? checklist.cards.filter((c) => !have.has(c.number)) : [];

  return (
    <div className="space-y-5">
      <div>
        <Link href="/sets" className="text-sm text-neutral-500 underline">
          All sets
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold">{checklist?.setName ?? setName}</h1>
        <p className="text-sm text-neutral-500">
          {GAMES[game as Game]} · {owned.length} card{owned.length === 1 ? "" : "s"} owned worth {money(ownedValue)}
          {checklist ? ` · ${checklist.cards.length} in the set` : " · no checklist fetched yet"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-display text-xl font-semibold uppercase tracking-wide">
            {checklist ? `Still missing (${missing.length})` : "Still missing"}
          </h2>
          {!checklist ? (
            <div className="card-surface p-6 text-sm text-neutral-500">
              Fetch this set’s checklist from the{" "}
              <Link href="/sets" className="underline">
                sets page
              </Link>{" "}
              to see what is missing.
            </div>
          ) : missing.length === 0 ? (
            <div className="card-surface p-6 text-sm">This set is complete.</div>
          ) : (
            <ul className="card-surface max-h-[32rem] divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
              {missing.map((c) => (
                <li key={`${c.number}-${c.name}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                    {/* The checklist was fetched from a third-party API and stored verbatim. */}
                    {httpUrl(c.imageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={httpUrl(c.imageUrl)!} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-xs text-neutral-500">
                      #{c.number}
                      {c.rarity ? ` · ${c.rarity}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl font-semibold uppercase tracking-wide">You have ({owned.length})</h2>
          <ul className="card-surface max-h-[32rem] divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
            {owned.map((card) => (
              <li key={card.id}>
                <Link href={`/cards/${card.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-black/[0.03] dark:hover:bg-white/5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {card.name}
                      {card.quantity > 1 ? ` ×${card.quantity}` : ""}
                    </div>
                    <div className="truncate text-xs text-neutral-500">
                      {card.cardNumber ? `#${card.cardNumber}` : "no number"}
                      {card.grade ? ` · ${card.gradingCompany ?? "Graded"} ${card.grade}` : ` · ${card.condition}`}
                      {card.location ? ` · ${card.location}` : ""}
                    </div>
                  </div>
                  <div className="font-medium">{money(prices.get(card.id)?.summary.yourCopyValue ?? null)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
