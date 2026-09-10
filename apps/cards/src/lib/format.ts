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
  return card.referenceImageUrl;
}
