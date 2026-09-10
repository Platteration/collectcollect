/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { money } from "../../format";

export interface TileProps {
  id: number;
  title: string;
  detail: string;
  condition: string;
  extra?: string | null;
  image: string | null;
  value: number | null;
  quantity: number;
  unique: boolean;
  sold: boolean;
  /** Left out of the total (opened, consumed). */
  excluded?: boolean;
  accent?: string | null;
}

/** One thing in a grid. Reads the same whatever is being collected. */
export function ItemTile(p: TileProps) {
  return (
    <Link
      href={`/items/${p.id}`}
      className={`card-surface group flex flex-col overflow-hidden transition hover:border-[var(--line-strong)] ${p.sold ? "opacity-60" : ""} ${p.accent ? "accent-wash" : ""}`}
      style={p.accent ? ({ "--accent": p.accent } as React.CSSProperties) : undefined}
    >
      <div className="well relative flex aspect-[4/3] items-center justify-center overflow-hidden">
        {p.image ? (
          <img src={p.image} alt="" loading="lazy" className="h-full w-full object-contain p-2" />
        ) : (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            No photo
          </span>
        )}
        {!p.unique && p.quantity > 1 && <span className="badge absolute right-2 top-2 bg-black/70 text-white">×{p.quantity}</span>}
        {p.sold && <span className="badge absolute right-2 top-2 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">Sold</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="font-display text-base font-semibold leading-tight">{p.title}</p>
        <p className="truncate text-xs" style={{ color: "var(--muted)" }}>
          {p.detail || "—"}
        </p>
        {p.extra && (
          <p className="truncate text-xs" style={{ color: "var(--muted)" }}>
            {p.extra}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {p.condition}
            </div>
            <div className="hero-figure text-lg">{p.value === null ? "—" : money(p.value)}</div>
          </div>
          {p.excluded && (
            <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              not counted
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
