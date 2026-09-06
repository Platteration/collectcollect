import Link from "next/link";
import { imageSrc, money } from "@/lib/format";
import { GAMES, type CardRecord, type PriceSummary } from "@/lib/types";

export function CardTile({ card, price }: { card: CardRecord; price: PriceSummary | null }) {
  const src = imageSrc(card);
  const graded = Boolean(card.grade);
  return (
    <Link href={`/cards/${card.id}`} className="card-surface group flex flex-col overflow-hidden hover:shadow-md">
      <div className="relative aspect-[3/4] bg-neutral-100 dark:bg-neutral-800">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={card.name} className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">No image</div>
        )}
        <span className="badge absolute left-2 top-2 bg-black/70 text-white">{GAMES[card.game]}</span>
        {card.quantity > 1 && (
          <span className="badge absolute right-2 top-2 bg-amber-600 text-white">×{card.quantity}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="truncate font-medium" title={card.name}>
          {card.name}
        </div>
        <div className="truncate text-xs text-neutral-500">
          {[card.setName, card.cardNumber ? `#${card.cardNumber}` : null, card.year].filter(Boolean).join(" · ") || "—"}
        </div>
        <div className="mt-auto flex items-end justify-between pt-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {graded ? `${card.gradingCompany ?? "Graded"} ${card.grade}` : `Raw · ${card.condition}`}
            </div>
            <div className="text-base font-semibold">{money(price?.yourCopyValue ?? null)}</div>
          </div>
          {price?.ungraded && graded && (
            <div className="text-right text-xs text-neutral-500">
              raw {money(price.ungraded)}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
