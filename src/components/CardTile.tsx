import Link from "next/link";
import { imageSrc, money } from "@/lib/format";
import { GAMES, type CardRecord, type PriceSummary } from "@/lib/types";
import { Slab } from "./Slab";

export function CardTile({ card, price }: { card: CardRecord; price: PriceSummary | null }) {
  const src = imageSrc(card);
  const graded = Boolean(card.grade);
  return (
    <Link href={`/cards/${card.id}`} className="card-surface group flex flex-col overflow-hidden hover:shadow-md">
      <div
        className={`relative aspect-[3/4] bg-neutral-100 p-2 dark:bg-neutral-800 ${card.accentColor ? "accent-wash" : ""}`}
        style={card.accentColor ? ({ "--accent": card.accentColor } as React.CSSProperties) : undefined}
      >
        {graded ? (
          <Slab company={card.gradingCompany} grade={card.grade!} compact>
            <Art src={src} name={card.name} className="h-full w-full object-contain" />
          </Slab>
        ) : (
          <Art src={src} name={card.name} className="h-full w-full object-contain" />
        )}
        <span className="badge absolute left-2 top-2 bg-black/70 text-white">{GAMES[card.game]}</span>
        {card.quantity > 1 && (
          <span className="badge absolute right-2 top-2 bg-amber-600 text-white">×{card.quantity}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="truncate font-display text-lg font-semibold leading-tight" title={card.name}>
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
            <div className="hero-figure text-xl">{money(price?.yourCopyValue ?? null)}</div>
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

function Art({ src, name, className }: { src: string | null; name: string; className: string }) {
  if (!src) {
    return <div className="flex h-full min-h-24 items-center justify-center text-sm text-neutral-400">No image</div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={name} className={className} loading="lazy" />;
}
