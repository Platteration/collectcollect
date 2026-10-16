"use client";

import { useId } from "react";
import { money } from "../format";
import type { OutlookPoint } from "../grading";
import { INK, bandPath, compactMoney, linePath, niceTicks, shortDate, timeTicks, useContainerWidth, useCrosshair, xScale, yScale, type Layout } from "../charts/chart-utils";

interface Props {
  series: OutlookPoint[];
  compact?: boolean;
  /** What the owner's own line is called in the legend. */
  rawLabel?: string;
}

/**
 * Min/max grading outlook for a raw copy: the band spans the mid-grade (min)
 * and gem-mint (max) outcomes; the line is what the raw copy is worth today.
 * The wider the band above the line, the more grading could add.
 */
export function OutlookChart({ series, compact = false, rawLabel = "Your raw copy" }: Props) {
  const { ref, width } = useContainerWidth<HTMLDivElement>(compact ? 320 : 800);
  const narrow = width < 480;
  const layout: Layout = compact ? { width, height: 90, left: 4, right: 4, top: 6, bottom: 6 } : { width, height: narrow ? 200 : 260, left: 8, right: narrow ? 48 : 56, top: 12, bottom: 24 };
  const times = series.map((p) => new Date(p.t).getTime());
  const all = series.flatMap((p) => [p.min, p.max, p.raw]);
  const { lo, hi, ticks } = niceTicks(Math.min(...all, 0), Math.max(...all, 1));
  const sx = xScale(times, layout);
  const sy = yScale(lo, hi, layout);
  const xs = times.map((t) => sx(t));
  const isEnd = (i: number) => i === times.length - 1 || xs[i] > layout.width - layout.right - 40;
  const upper: Array<[number, number]> = series.map((p, i) => [xs[i], sy(p.max)]);
  const lower: Array<[number, number]> = series.map((p, i) => [xs[i], sy(p.min)]);
  const raw: Array<[number, number]> = series.map((p, i) => [xs[i], sy(p.raw)]);
  const { index, onMove, onLeave, onKey, setIndex } = useCrosshair(xs);
  const bandId = `outlook-band-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  if (series.length === 0) {
    return (
      <div ref={ref} className="text-sm" style={{ color: "var(--muted)" }}>
        No outlook yet. Refresh prices first.
      </div>
    );
  }
  const active = index !== null ? series[index] : null;
  const last = series[series.length - 1];
  const single = series.length === 1;
  const description =
    `Grading outlook: gem-mint and mid-grade outcomes versus the raw price over time. ` +
    `Latest ${last.maxLabel} ${money(last.max)}, ${last.minLabel} ${money(last.min)}, raw ${money(last.raw)}, ` +
    `upside after the ${money(last.fee)} fee ${money(last.upside)}.` +
    (compact ? "" : " Use the left and right arrow keys to read each point.");
  const spoken = active
    ? `${shortDate(active.t, true)}: ${active.maxLabel} ${money(active.max)}, ${active.minLabel} ${money(active.min)}, raw ${money(active.raw)}, upside after the ${money(active.fee)} fee ${money(active.upside)}.`
    : "";

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        className="block h-auto w-full touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-solid)]"
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
          timeTicks(times, xs, series.map((p) => shortDate(p.t)), narrow ? 3 : 4).map((i) => (
            <text key={i} x={xs[i]} y={layout.height - 6} fontSize={11} fill={INK.muted} textAnchor={i === 0 ? "start" : isEnd(i) ? "end" : "middle"}>
              {shortDate(series[i].t)}
            </text>
          ))}
        {index !== null && (
          <g>
            <line x1={xs[index]} x2={xs[index]} y1={layout.top} y2={layout.height - layout.bottom} stroke={INK.axis} strokeWidth={1} />
            <circle cx={upper[index][0]} cy={upper[index][1]} r={4} fill={INK.max} stroke={INK.surface} strokeWidth={2} />
            <circle cx={lower[index][0]} cy={lower[index][1]} r={4} fill={INK.min} stroke={INK.surface} strokeWidth={2} />
            <circle cx={raw[index][0]} cy={raw[index][1]} r={4} fill={INK.raw} stroke={INK.surface} strokeWidth={2} />
          </g>
        )}
        {xs.map((x, i) => (
          <rect key={i} x={x - 12} y={0} width={24} height={layout.height} fill="transparent" onPointerEnter={() => setIndex(i)} />
        ))}
      </svg>
      {!compact && (
        <p className="sr-only" role="status" aria-live="polite">
          {spoken}
        </p>
      )}
      {active && (
        <div className="tooltip-surface pointer-events-none absolute top-0 z-10 rounded-md px-2 py-1 text-xs" style={{ left: `${(xs[index!] / layout.width) * 100}%`, transform: xs[index!] > layout.width / 2 ? "translateX(-105%)" : "translateX(8px)" }}>
          <div style={{ color: "var(--muted)" }}>{shortDate(active.t, true)}</div>
          <Row color={INK.max} label={active.maxLabel} value={active.max} />
          <Row color={INK.min} label={active.minLabel} value={active.min} />
          <Row color={INK.raw} label={rawLabel} value={active.raw} />
          <div className="mt-1 border-t pt-1" style={{ borderColor: "var(--line)" }}>
            Upside after {money(active.fee)} fee: <strong>{money(active.upside)}</strong>
          </div>
        </div>
      )}
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-4 text-xs" style={{ color: "var(--muted)" }}>
          <Key color={INK.max} label={`${last.maxLabel} (max)`} />
          <Key color={INK.min} label={`${last.minLabel} (min)`} />
          <Key color={INK.raw} label={rawLabel} />
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
      <span style={{ color: "var(--muted)" }}>{label}</span>
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
