/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { money } from "@collectcollect/core/format";
import type { ItemRecord } from "@/lib/types";
import { CATEGORIES, EXTERIORS, RARITIES } from "@/lib/types";
import { isTradeLocked } from "@/lib/items";

/**
 * One item in a grid.
 *
 * Rarity is drawn as the bar the game itself uses, and also printed as a word:
 * the colour is the fast read, the word is the one that survives a colour-blind
 * viewer, a greyscale print or a screen reader.
 *
 * Steam serves every skin image from its own CDN and never at a size this grid
 * chose, so these are plain `img` tags rather than the optimiser: there is
 * nothing local to optimise, and routing someone else's CDN through a resizing
 * proxy would add a hop and a failure mode for no gain.
 */
export function ItemTile({ item, value }: { item: ItemRecord; value: number | null }) {
  const rarity = item.rarity ? RARITIES[item.rarity] : null;
  const locked = isTradeLocked(item);
  return (
    <Link
      href={`/items/${item.id}`}
      className="card-surface rarity-wash group relative flex flex-col overflow-hidden transition hover:border-[var(--line-strong)]"
      style={rarity ? ({ ["--rarity" as string]: rarity.color }) : undefined}
    >
      <span aria-hidden className="rarity-bar absolute inset-y-0 left-0 w-1" />
      <div className="well flex aspect-[4/3] items-center justify-center overflow-hidden">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain p-2" />
        ) : (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            No image
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 pl-4">
        <p className="font-display text-sm leading-tight font-semibold">{item.marketHashName}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {[
            CATEGORIES[item.category],
            item.exterior ? EXTERIORS[item.exterior] : null,
            rarity?.label,
            item.stattrak ? "StatTrak™" : null,
            item.souvenir ? "Souvenir" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {item.floatValue !== null && (
          <p className="text-xs" style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            float {Number(item.floatValue.toFixed(6))}
            {item.paintSeed !== null && ` · pattern ${item.paintSeed}`}
          </p>
        )}
        <div className="mt-auto flex items-baseline justify-between gap-2 pt-2">
          <span className="hero-figure text-lg">{value === null ? "—" : money(value)}</span>
          {item.stackable && item.quantity !== 1 && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              ×{item.quantity}
            </span>
          )}
        </div>
        {locked && (
          <p className="text-xs" style={{ color: "var(--chart-bad-text)" }}>
            Trade locked until {item.tradableAfter!.slice(0, 10)}
          </p>
        )}
      </div>
    </Link>
  );
}
