import { EXTERIORS, EXTERIOR_RANGES, exteriorForFloat, wearWithinTier } from "@/lib/types";

/**
 * Where this item's float sits on the 0-to-1 wear scale.
 *
 * The bands are the game's own, so the widths are the ranges themselves rather
 * than five equal blocks — which is the point: Field-Tested is nearly a quarter
 * of the scale and Well-Worn is a sliver, and a bar drawn in equal blocks would
 * say the opposite. The number is printed alongside, because the position of a
 * marker on a 200-pixel bar cannot carry ten decimal places.
 */
export function FloatBar({ value, showScale = true }: { value: number; showScale?: boolean }) {
  const tier = exteriorForFloat(value);
  const within = wearWithinTier(value);
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div>
      <div className="relative">
        <div className="float-track h-2 w-full rounded-full" aria-hidden />
        <span
          aria-hidden
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${pct}%`, background: "var(--foreground)", boxShadow: "0 0 0 2px var(--background)" }}
        />
      </div>
      {showScale && (
        <div className="mt-1.5 flex items-baseline justify-between text-xs" style={{ color: "var(--muted)" }}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{Number(value.toFixed(10))}</span>
          <span>
            {tier ? EXTERIORS[tier] : "—"}
            {tier && within !== null && (
              <>
                {" · "}
                {Math.round(within * 100)}% through {Number(EXTERIOR_RANGES[tier].min)}–{Number(EXTERIOR_RANGES[tier].max)}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
