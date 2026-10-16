"use client";

import type { PortfolioPoint } from "@/lib/analytics";
import { money } from "@/lib/format";
import { ValueChart, type Basis } from "@collectcollect/core/components/ValueChart";

interface Props {
  points: PortfolioPoint[];
  up: boolean;
  onHover?: (point: PortfolioPoint | null) => void;
  height?: number;
  /** Tooltip footer; defaults to the collection-level "raw NM … · n priced" line. */
  detail?: (point: PortfolioPoint) => string;
  label?: string;
  /** Draw the cost-basis line: what the copies held at each point were paid for. */
  showCost?: boolean;
  /** What the cost line is called in the tooltip ("cost basis", "paid"). */
  costLabel?: string;
}

/**
 * How far the value is ahead of the cost, over the copies the cost covers. A
 * point that says which value its cost was measured against (`costedValue`)
 * is held to that; one that does not is a single copy, whose value it is.
 */
const gainOf = (p: PortfolioPoint): number | null => ((p.cost ?? 0) > 0 ? (p.costedValue ?? p.value) - (p.cost ?? 0) : null);

export function PortfolioChart({ points, up, onHover, height = 260, detail, label = "Collection value over time", showCost = false, costLabel = "cost basis" }: Props) {
  const basis: Basis<PortfolioPoint> | undefined = showCost ? { label: costLabel, at: (p) => p.cost ?? null, gain: gainOf } : undefined;
  return (
    <ValueChart
      points={points}
      up={up}
      onHover={onHover}
      height={height}
      label={label}
      axis="data"
      basis={basis}
      empty="No price history yet. Refresh prices to start the chart."
      detail={detail ?? ((p) => `raw NM ${money(p.ungraded)} · ${p.priced} priced`)}
    />
  );
}
