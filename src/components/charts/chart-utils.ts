"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Layout {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function xScale(times: number[], layout: Layout) {
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  const innerW = layout.width - layout.left - layout.right;
  return (t: number) => layout.left + ((t - min) / span) * innerW;
}

export function yScale(lo: number, hi: number, layout: Layout) {
  const span = hi - lo || 1;
  const innerH = layout.height - layout.top - layout.bottom;
  return (v: number) => layout.top + innerH - ((v - lo) / span) * innerH;
}

/** Round axis bounds outward to clean numbers and produce ~3 gridline values. */
export function niceTicks(lo: number, hi: number, count = 3): { lo: number; hi: number; ticks: number[] } {
  if (hi <= lo) {
    hi = lo + Math.max(1, Math.abs(lo) * 0.1);
  }
  const rawStep = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const nlo = Math.floor(lo / step) * step;
  const nhi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = nlo; v <= nhi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo: nlo, hi: nhi, ticks };
}

export function linePath(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export function areaPath(points: Array<[number, number]>, baseline: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${last[0].toFixed(1)},${baseline.toFixed(1)} L${first[0].toFixed(1)},${baseline.toFixed(1)} Z`;
}

/** Band between an upper and a lower series (same x positions). */
export function bandPath(upper: Array<[number, number]>, lower: Array<[number, number]>): string {
  if (upper.length === 0) return "";
  const up = linePath(upper);
  const down = [...lower].reverse().map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return `${up} ${down} Z`;
}

export function compactMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `$${(v / 1e3).toFixed(1)}K`;
  const decimals = Number.isInteger(v) || abs >= 100 ? 0 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

export function shortDate(iso: string, withTime = false): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", withTime ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
}

/**
 * X-axis tick indexes: points nearest to `count` evenly spaced instants, with
 * neighbours dropped when they would sit closer than `minGap` (viewBox px) or
 * repeat the same label. Points are often unevenly spaced in time (manual
 * refreshes), so ticking by index would bunch labels together.
 */
export function timeTicks(times: number[], xs: number[], labels: string[], count = 4, minGap = 70): number[] {
  if (times.length === 0) return [];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const chosen: number[] = [];
  for (let k = 0; k < count; k++) {
    const target = min + ((max - min) * k) / Math.max(1, count - 1);
    let best = 0;
    let bestD = Infinity;
    times.forEach((t, i) => {
      const d = Math.abs(t - target);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const prev = chosen[chosen.length - 1];
    if (prev !== undefined && (best === prev || xs[best] - xs[prev] < minGap || labels[best] === labels[prev])) continue;
    chosen.push(best);
  }
  return chosen;
}

/** Tracks the pointer over an SVG and snaps to the nearest data index. */
export function useCrosshair(xs: number[]) {
  const [index, setIndex] = useState<number | null>(null);
  const onMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const vb = e.currentTarget.viewBox.baseVal;
      const x = ((e.clientX - rect.left) / rect.width) * (vb.width || rect.width);
      let best = 0;
      let bestD = Infinity;
      xs.forEach((px, i) => {
        const d = Math.abs(px - x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setIndex(xs.length ? best : null);
    },
    [xs],
  );
  const onLeave = useCallback(() => setIndex(null), []);
  const onKey = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      if (!xs.length) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(xs.length - 1, (i ?? -1) + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, (i ?? xs.length) - 1));
      if (e.key === "Escape") setIndex(null);
    },
    [xs],
  );
  return { index, setIndex, onMove, onLeave, onKey };
}

/** Chart chrome tokens (light / dark handled through CSS variables set in globals.css). */
export const INK = {
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  muted: "var(--chart-muted)",
  surface: "var(--chart-surface)",
  good: "var(--chart-good)",
  bad: "var(--chart-bad)",
  raw: "var(--chart-series-1)",
  max: "var(--chart-series-2)",
  min: "var(--chart-series-3)",
};

/**
 * Pixel width of a container, so a chart can size its viewBox to the space
 * it actually has instead of scaling an 800px drawing down to a phone.
 */
export function useContainerWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)) || fallback);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, width };
}
