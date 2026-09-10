/**
 * Only http(s) URLs may be rendered as a link or an image source. Values that
 * came from outside — a price provider's response, a set checklist, or a
 * restored database — are checked here at the point of use, because the guard
 * on the way in (`normalizeInput`) only covers what this app wrote itself.
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

export function imageSrc(card: { imagePath: string | null; referenceImageUrl: string | null }): string | null {
  if (card.imagePath) return `/api/uploads/${card.imagePath}`;
  return httpUrl(card.referenceImageUrl);
}
