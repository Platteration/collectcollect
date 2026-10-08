"use client";

import type { PortfolioPoint } from "@/lib/analytics";
import { money } from "@/lib/format";
import { ValueChart } from "@collectcollect/core/components/ValueChart";

interface Props {
  points: PortfolioPoint[];
  up: boolean;
  onHover?: (point: PortfolioPoint | null) => void;
  height?: number;
  /** Tooltip footer; defaults to the collection-level "raw NM … · n priced" line. */
  detail?: (point: PortfolioPoint) => string;
  label?: string;
}

export function PortfolioChart({ points, up, onHover, height = 260, detail, label = "Collection value over time" }: Props) {
  return (
    <ValueChart
      points={points}
      up={up}
      onHover={onHover}
      height={height}
      label={label}
      empty="No price history yet. Refresh prices to start the chart."
      detail={detail ?? ((p) => `raw NM ${money(p.ungraded)} · ${p.priced} priced`)}
    />
  );
}
