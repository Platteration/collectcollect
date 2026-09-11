"use client";

import { useEffect, useId } from "react";
import { money } from "../format";
import {
  INK,
  areaPath,
  compactMoney,
  linePath,
  niceTicks,
  shortDate,
  timeTicks,
  useContainerWidth,
  useCrosshair,
  xScale,
  yScale,
  type Layout,
} from "../charts/chart-utils";

/** The only thing this chart needs to know about a point. */
export interface ValuePoint {
  t: string;
  value: number;
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
}: Props<P>) {
  const { ref, width } = useContainerWidth<HTMLDivElement>(LAYOUT.width);
  const narrow = width < 480;
  const layout: Layout = { ...LAYOUT, width, height: narrow ? Math.round(height * 0.8) : height, right: narrow ? 48 : LAYOUT.right };
  const times = points.map((p) => new Date(p.t).getTime());
  const values = points.map((p) => p.value);
  const { lo, hi, ticks } = niceTicks(Math.min(...values, 0), Math.max(...values, 1));
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
  const description =
    `${label}. ${points.length} price${points.length === 1 ? "" : "s"} from ${shortDate(first.t)} to ${shortDate(last.t)}, ` +
    `latest ${money(last.value)}. Use the left and right arrow keys to read each value.`;
  const spoken = active ? `${shortDate(active.t, true)}: ${money(active.value)}.${detail ? ` ${detail(active)}` : ""}` : "";

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
        {ticks.map((v) => (
          <g key={v}>
            <line x1={layout.left} x2={layout.width - layout.right} y1={sy(v)} y2={sy(v)} stroke={INK.grid} strokeWidth={1} />
            <text
              x={layout.width - layout.right + 6}
              y={sy(v) + 4}
              fontSize={11}
              fill={INK.muted}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {compactMoney(v)}
            </text>
          </g>
        ))}
        <path d={areaPath(coords, baseline)} fill={`url(#${gradientId})`} />
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
          {detail && <div style={{ color: "var(--muted)" }}>{detail(active)}</div>}
        </div>
      )}
    </div>
  );
}
