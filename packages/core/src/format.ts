/** How money and timestamps are written on screen, in either app. */

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
