/** How money, timestamps and outside links are written on screen, in either app. */

/**
 * Only an http(s) URL may be rendered as a link or an image source. Values that
 * came from outside — a price source's response, a set checklist, a market's
 * listing, or a restored database — are checked here at the point of use,
 * because the guard on the way in only covers what the app wrote itself.
 */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function money(value: number | null | undefined, currency: "USD" | "EUR" = "USD"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * A calendar day, for dates that are dates rather than moments: when a lot
 * was bought, when a sale happened, when a trade lock lifts. Same locale and
 * style as `when`, so a page never shows one date two ways.
 */
export function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { dateStyle: "medium" });
}
