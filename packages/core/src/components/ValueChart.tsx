"use client";

import { useEffect, useId } from "react";
import { money } from "../format";
import {
  INK,
  areaPath,
  linePath,
  niceScale,
  niceTicks,
  shortDate,
  tickLabels,
  timeTicks,
  useContainerWidth,
  useCrosshair,
  xScale,
  yScale,
  type Layout,
} from "../charts/chart-utils";
import { extent } from "../series";

/** The only thing this chart needs to know about a point. */
export interface ValuePoint {
  t: string;
  value: number;
}

/**
 * A second, dashed line the value is measured against: what the copies held
 * cost, say. It is drawn only where it has a figure.
 */
export interface Basis<P> {
  /** What it is called in the tooltip and to a screen reader: "cost basis", "paid". */
  label: string;
  /** Where the line sits at a point; null or 0 where it has nothing to say. */
  at: (point: P) => number | null;
  /** How far the value is ahead (+) or behind (−) it at a point, when that is known. */
  gain?: (point: P) => number | null;
}

interface Props<P extends ValuePoint> {
  points: P[];
  /** Which way the series has gone, which is what the fill colour carries. */
  up: boolean;
  onHover?: (point: P | null) => void;
  height?: number;
  /** A second line under the value in the tooltip, and in what a screen reader hears. */
  detail?: (point: P) => string;
  label: string;
  /** Shown in place of the chart when there is nothing to draw yet. */
  empty?: string;
  /**
   * `zero` (the default) starts the axis at zero, which suits a total that is
   * built from nothing. `data` fits it to the line, with a dotted rule at the
   * value the series opened at, so a 2% week reads as a 2% week.
   */
  axis?: "zero" | "data";
  basis?: Basis<P>;
}

const LAYOUT: Layout = { width: 800, height: 260, left: 8, right: 56, top: 12, bottom: 24 };

/**
 * A value-over-time line. Readable with a pointer, with a keyboard, and by a
 * screen reader: the crosshair is focusable, arrow keys walk the points, and
 * whatever it lands on is announced, so the tooltip is never the only way to
 * read a number.
 */
export function ValueChart<P extends ValuePoint>({
  points,
  up,
  onHover,
  height = 260,
  detail,
  label,
  empty = "No price history yet.",
  axis = "zero",
  basis,
}: Props<P>) {
  const { ref, width } = useContainerWidth<HTMLDivElement>(LAYOUT.width);
  const narrow = width < 480;
  const times = points.map((p) => new Date(p.t).getTime());
  const values = points.map((p) => p.value);
  // The basis line is drawn where it has a figure above zero; the scale has to
  // take in what is drawn, or the line would run off the frame.
  const basisAt = points.map((p) => {
    const v = basis ? basis.at(p) : null;
    return v !== null && Number.isFinite(v) && v > 0 ? v : null;
  });
  const drawnBasis = basisAt.filter((v): v is number => v !== null);
  const [minValue, maxValue] = extent([...values, ...drawnBasis]);
  const fit = axis === "data" && points.length > 0;
  const pad = (maxValue - minValue) * 0.08 || Math.max(1, Math.abs(maxValue) * 0.02);
  const { lo, hi, ticks } = fit ? niceScale(Math.max(0, minValue - pad), Math.max(maxValue, 1) + pad) : niceTicks(Math.min(minValue, 0), Math.max(maxValue, 1));
  // Gridline labels sit in the right margin; a fitted scale can need the full
  // figure ($15,005) where a zero-based one gets by on $15K, so the margin
  // grows to the longest label rather than letting it run off the drawing.
  const tickText = tickLabels(ticks);
  const labelWidth = Math.ceil(Math.max(0, ...tickText.map((t) => t.length)) * 6.2) + 6;
  const layout: Layout = { ...LAYOUT, width, height: narrow ? Math.round(height * 0.8) : height, right: Math.max(narrow ? 48 : LAYOUT.right, labelWidth) };
  const sx = xScale(times, layout);
  const sy = yScale(lo, hi, layout);
  const coords: Array<[number, number]> = points.map((p) => [sx(new Date(p.t).getTime()), sy(p.value)]);
  const xs = coords.map(([x]) => x);
  const labels = points.map((p) => shortDate(p.t));
  const isEnd = (i: number) => {
    const x = xs[i];
    return i === times.length - 1 || (x !== undefined && x > layout.width - layout.right - 40);
  };
  const { index, onMove, onLeave, onKey, setIndex } = useCrosshair(xs);
  const color = up ? INK.good : INK.bad;
  const baseline = sy(lo);
  // Where the series opened, so the line reads against its own starting value.
  const opening = points[0];
  const open = fit && opening !== undefined && points.length > 1 ? sy(opening.value) : null;
  // Runs of the basis line, broken wherever it has no figure.
  const basisRuns: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  basisAt.forEach((v, i) => {
    const x = xs[i];
    if (v === null || x === undefined) {
      if (run.length) basisRuns.push(run);
      run = [];
    } else run.push([x, sy(v)]);
  });
  if (run.length) basisRuns.push(run);
  // Two charts on one page must not share a gradient id.
  const gradientId = `value-fill-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // Pointer, keyboard and hit-rect updates all land on `index`; report every change upward.
  useEffect(() => {
    onHover?.(index === null ? null : (points[index] ?? null));
  }, [index, points, onHover]);

  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return (
      <div
        ref={ref}
        className="flex h-40 items-center justify-center rounded-lg border border-dashed border-black/10 text-sm dark:border-white/10"
        style={{ color: "var(--muted)" }}
      >
        {empty}
      </div>
    );
  }

  const active = index !== null ? points[index] : null;
  const activeCoord = index !== null ? coords[index] : undefined;
  const single = points.length === 1 ? coords[0] : undefined;
  // What a screen reader is told. The crosshair is reachable from the keyboard,
  // so what it lands on has to be readable without seeing the tooltip.
  const lastBasis = basisAt[points.length - 1] ?? null;
  const description =
    `${label}. ${points.length} observation${points.length === 1 ? "" : "s"} from ${shortDate(first.t)} to ${shortDate(last.t)}, ` +
    `latest ${money(last.value)}${basis && lastBasis !== null ? `, ${basis.label} ${money(lastBasis)}` : ""}. Use the left and right arrow keys to read each value.`;
  // The line below the value in the tooltip: what it is measured against, and
  // how far ahead or behind it the value is. The direction is the sign and the
  // arrow as well as the colour.
  const activeBasis = index !== null ? (basisAt[index] ?? null) : null;
  const activeGain = basis?.gain && active ? basis.gain(active) : null;
  const gainText = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
  const basisSpoken =
    basis && activeBasis !== null ? ` ${basis.label} ${money(activeBasis)}${activeGain !== null ? `, ${activeGain >= 0 ? "ahead" : "behind"} by ${money(Math.abs(activeGain))}` : ""}.` : "";
  const spoken = active ? `${shortDate(active.t, true)}: ${money(active.value)}.${basisSpoken}${detail ? ` ${detail(active)}` : ""}` : "";

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        className="block h-auto w-full touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-solid)]"
        role="img"
        aria-label={description}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onKeyDown={onKey}
      >
        <defs>
          {/* The fill carries the direction: green climbing, red falling,
              fading out towards the baseline so the line stays the loudest mark. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="45%" stopColor={color} stopOpacity="0.08" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v, k) => (
          <g key={v}>
            <line x1={layout.left} x2={layout.width - layout.right} y1={sy(v)} y2={sy(v)} stroke={INK.grid} strokeWidth={1} />
            <text
              x={layout.width - layout.right + 6}
              y={sy(v) + 4}
              fontSize={11}
              fill={INK.muted}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {tickText[k]}
            </text>
          </g>
        ))}
        <path d={areaPath(coords, baseline)} fill={`url(#${gradientId})`} />
        {open !== null && <line data-series="opening" x1={layout.left} x2={layout.width - layout.right} y1={open} y2={open} stroke={INK.axis} strokeWidth={1} strokeDasharray="2 3" />}
        {/* Dashed, so the line is told apart by its shape and not only its colour. */}
        {basisRuns.map((r, i) =>
          r.length > 1 ? (
            <path key={i} data-series="basis" d={linePath(r)} fill="none" stroke="var(--chart-series-1)" strokeWidth={1.5} strokeDasharray="5 4" strokeLinejoin="round" />
          ) : (
            <circle key={i} data-series="basis" cx={r[0]?.[0]} cy={r[0]?.[1]} r={2.5} fill="var(--chart-series-1)" />
          ),
        )}
        <path d={linePath(coords)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {single && <circle cx={single[0]} cy={single[1]} r={4} fill={color} stroke={INK.surface} strokeWidth={2} />}
        {timeTicks(times, xs, labels, narrow ? 3 : 4).map((i) => (
          <text
            key={i}
            x={xs[i]}
            y={layout.height - 6}
            fontSize={11}
            fill={INK.muted}
            textAnchor={i === 0 ? "start" : isEnd(i) ? "end" : "middle"}
          >
            {labels[i]}
          </text>
        ))}
        {activeCoord && (
          <g>
            <line x1={activeCoord[0]} x2={activeCoord[0]} y1={layout.top} y2={layout.height - layout.bottom} stroke={INK.axis} strokeWidth={1} />
            <circle cx={activeCoord[0]} cy={activeCoord[1]} r={5} fill={color} stroke={INK.surface} strokeWidth={2} />
          </g>
        )}
        {/* Invisible hit areas so keyboard and touch users can land on points. */}
        {xs.map((x, i) => (
          <rect
            key={i}
            x={x - 12}
            y={layout.top}
            width={24}
            height={layout.height - layout.top - layout.bottom}
            fill="transparent"
            onPointerEnter={() => setIndex(i)}
          />
        ))}
      </svg>
      {/* The tooltip is drawn for the eye; this is the same thing, spoken. */}
      <p className="sr-only" role="status" aria-live="polite">
        {spoken}
      </p>
      {active && activeCoord && (
        <div
          className="tooltip-surface pointer-events-none absolute top-0 rounded-md px-2 py-1 text-xs"
          style={{
            left: `${(activeCoord[0] / layout.width) * 100}%`,
            transform: activeCoord[0] > layout.width / 2 ? "translateX(-105%)" : "translateX(8px)",
          }}
        >
          <div className="font-semibold">{money(active.value)}</div>
          <div style={{ color: "var(--muted)" }}>{shortDate(active.t, true)}</div>
          {basis && activeBasis !== null && (
            <div style={{ color: "var(--muted)" }}>
              {/* Each half stays whole, so a tooltip with little room wraps between them, not through a figure. */}
              <span style={{ whiteSpace: "nowrap" }}>
                {basis.label} {money(activeBasis)}
                {activeGain !== null ? " ·" : ""}
              </span>
              {activeGain !== null && (
                <>
                  {" "}
                  <span style={{ whiteSpace: "nowrap", color: activeGain >= 0 ? "var(--chart-good-text)" : "var(--chart-bad-text)" }}>
                    {activeGain >= 0 ? "▲" : "▼"} {gainText(activeGain)}
                  </span>
                </>
              )}
            </div>
          )}
          {detail && <div style={{ color: "var(--muted)" }}>{detail(active)}</div>}
        </div>
      )}
    </div>
  );
}
