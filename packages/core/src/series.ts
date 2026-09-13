/**
 * Helpers for long series of points. Both are loops rather than spreads:
 * `Math.min(...xs)` passes every element as an argument, and a year of hourly
 * snapshots across a few hundred items is enough to overflow the call stack.
 */

/** The smallest and largest of many numbers. An empty list gives `[Infinity, -Infinity]`, as the spreads did. */
export function extent(xs: Iterable<number>): [min: number, max: number] {
  let min = Infinity;
  let max = -Infinity;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return [min, max];
}

/**
 * At most `max` points, evenly spaced through the series, always keeping the
 * first and the last. A chart a few hundred pixels wide cannot show more than
 * that anyway, and neither can the page carry them to the browser for nothing.
 */
export function thinPoints<T>(points: readonly T[], max = 2000): T[] {
  if (points.length <= max) return [...points];
  if (max < 2) return points.length ? [points[points.length - 1] as T] : [];
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let k = 0; k < max; k++) out.push(points[Math.round(k * step)] as T);
  return out;
}
