"use client";

import type { OutlookPoint } from "@/lib/analytics";
import { money } from "@/lib/format";
import { useId } from "react";
import { INK, bandPath, compactMoney, linePath, niceTicks, shortDate, timeTicks, useContainerWidth, useCrosshair, xScale, yScale, type Layout } from "@collectcollect/core/charts/chart-utils";

interface Props {
  series: OutlookPoint[];
  compact?: boolean;
}

/**
 * Min/max grading outlook for a raw card: the band spans the mid-grade (min)
 * and gem-mint (max) outcomes; the line is what the raw copy is worth today.
 * The wider the band above the line, the more grading could add.
 */
export function OutlookChart({ series, compact = false }: Props) {
  const { ref, width } = useContainerWidth<HTMLDivElement>(compact ? 320 : 800);
  const narrow = width < 480;
  const layout: Layout = compact
    ? { width, height: 90, left: 4, right: 4, top: 6, bottom: 6 }
    : { width, height: narrow ? 200 : 260, left: 8, right: narrow ? 48 : 56, top: 12, bottom: 24 };
  const dated = series.map((p) => ({ ...p, time: new Date(p.t).getTime() }));
  const times = dated.map((p) => p.time);
  const all = series.flatMap((p) => [p.min, p.max, p.raw]);
  const { lo, hi, ticks } = niceTicks(Math.min(...all, 0), Math.max(...all, 1));
  const sx = xScale(times, layout);
  const sy = yScale(lo, hi, layout);
  // Each point carries its own x position, so drawing never looks one up by index.
  const plotted = dated.map((p) => ({ ...p, x: sx(p.time) }));
  const xs = plotted.map((p) => p.x);
  const isEnd = (i: number, x: number) => i === times.length - 1 || x > layout.width - layout.right - 40;
  const upper: Array<[number, number]> = plotted.map((p) => [p.x, sy(p.max)]);
  const lower: Array<[number, number]> = plotted.map((p) => [p.x, sy(p.min)]);
  const raw: Array<[number, number]> = plotted.map((p) => [p.x, sy(p.raw)]);
  const { index, onMove, onLeave, onKey, setIndex } = useCrosshair(xs);
  const bandId = `outlook-band-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const last = plotted.at(-1);
  if (last === undefined) {
    return (
      <div ref={ref} className="text-sm text-neutral-500">
        No outlook yet. Refresh prices first.
      </div>
    );
  }
  const active = index !== null ? (plotted[index] ?? null) : null;
  const single = series.length === 1;
  const description =
    `Grading outlook: gem-mint and mid-grade outcomes versus the raw price over time. ` +
    `Latest ${last.maxLabel} ${money(last.max)}, ${last.minLabel} ${money(last.min)}, raw ${money(last.raw)}, ` +
    `upside after the ${money(last.fee)} fee ${money(last.upside)}.` +
    (compact ? "" : " Use the left and right arrow keys to read each point.");
  const spoken = active
    ? `${shortDate(active.t, true)}: ${active.maxLabel} ${money(active.max)}, ${active.minLabel} ${money(active.min)}, ` +
      `raw ${money(active.raw)}, upside after the ${money(active.fee)} fee ${money(active.upside)}.`
    : "";

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        className="block h-auto w-full touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
        role="img"
        aria-label={description}
        tabIndex={compact ? -1 : 0}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onKeyDown={onKey}
      >
        <defs>
          <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INK.max} stopOpacity="0.34" />
            <stop offset="100%" stopColor={INK.max} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {!compact &&
          ticks.map((v) => (
            <g key={v}>
              <line x1={layout.left} x2={layout.width - layout.right} y1={sy(v)} y2={sy(v)} stroke={INK.grid} strokeWidth={1} />
              <text x={layout.width - layout.right + 6} y={sy(v) + 4} fontSize={11} fill={INK.muted} style={{ fontVariantNumeric: "tabular-nums" }}>
                {compactMoney(v)}
              </text>
            </g>
          ))}
        {single ? (
          <g>
            <line x1={layout.left} x2={layout.width - layout.right} y1={sy(last.max)} y2={sy(last.max)} stroke={INK.max} strokeWidth={2} />
            <line x1={layout.left} x2={layout.width - layout.right} y1={sy(last.min)} y2={sy(last.min)} stroke={INK.min} strokeWidth={2} />
            <line x1={layout.left} x2={layout.width - layout.right} y1={sy(last.raw)} y2={sy(last.raw)} stroke={INK.raw} strokeWidth={2} />
          </g>
        ) : (
          <g>
            <path d={bandPath(upper, lower)} fill={`url(#${bandId})`} />
            <path d={linePath(upper)} fill="none" stroke={INK.max} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={linePath(lower)} fill="none" stroke={INK.min} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={linePath(raw)} fill="none" stroke={INK.raw} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        )}
        {!compact &&
          timeTicks(times, xs, plotted.map((p) => shortDate(p.t)), narrow ? 3 : 4).map((i) => {
            const p = plotted[i];
            if (p === undefined) return null;
            return (
              <text key={i} x={p.x} y={layout.height - 6} fontSize={11} fill={INK.muted} textAnchor={i === 0 ? "start" : isEnd(i, p.x) ? "end" : "middle"}>
                {shortDate(p.t)}
              </text>
            );
          })}
        {active && (
          <g>
            <line x1={active.x} x2={active.x} y1={layout.top} y2={layout.height - layout.bottom} stroke={INK.axis} strokeWidth={1} />
            <circle cx={active.x} cy={sy(active.max)} r={4} fill={INK.max} stroke={INK.surface} strokeWidth={2} />
            <circle cx={active.x} cy={sy(active.min)} r={4} fill={INK.min} stroke={INK.surface} strokeWidth={2} />
            <circle cx={active.x} cy={sy(active.raw)} r={4} fill={INK.raw} stroke={INK.surface} strokeWidth={2} />
          </g>
        )}
        {xs.map((x, i) => (
          <rect key={i} x={x - 12} y={0} width={24} height={layout.height} fill="transparent" onPointerEnter={() => setIndex(i)} />
        ))}
      </svg>
      {/* The tooltip is drawn for the eye; this is the same thing, spoken. */}
      {!compact && (
        <p className="sr-only" role="status" aria-live="polite">
          {spoken}
        </p>
      )}
      {active && (
        <div
          className="tooltip-surface pointer-events-none absolute top-0 z-10 rounded-md px-2 py-1 text-xs"
          style={{ left: `${(active.x / layout.width) * 100}%`, transform: active.x > layout.width / 2 ? "translateX(-105%)" : "translateX(8px)" }}
        >
          <div className="text-neutral-500">{shortDate(active.t, true)}</div>
          <Row color={INK.max} label={active.maxLabel} value={active.max} />
          <Row color={INK.min} label={active.minLabel} value={active.min} />
          <Row color={INK.raw} label="Raw (yours)" value={active.raw} />
          <div className="mt-1 border-t border-black/10 pt-1 dark:border-white/10">
            Upside after {money(active.fee)} fee: <strong>{money(active.upside)}</strong>
          </div>
        </div>
      )}
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-600 dark:text-neutral-300">
          <Key color={INK.max} label={`${last.maxLabel} (max)`} />
          <Key color={INK.min} label={`${last.minLabel} (min)`} />
          <Key color={INK.raw} label="Your raw copy" />
        </div>
      )}
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-0.5 w-3" style={{ background: color }} />
      <strong>{money(value)}</strong>
      <span className="text-neutral-500">{label}</span>
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />
      {label}
    </span>
  );
}
