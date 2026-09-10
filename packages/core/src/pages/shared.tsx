import type { DomainSpec, ItemRecord } from "../domain/spec";

/** Where an item's picture comes from: its first photo, else the source's reference image. */
export function imageOf(item: Pick<ItemRecord, "photos" | "referenceImageUrl">): string | null {
  return item.photos[0] ? `/api/uploads/${item.photos[0]}` : item.referenceImageUrl;
}

export function photoHref(name: string): string {
  return `/api/uploads/${name}`;
}

/** The first value of a query parameter, whichever way Next hands it over. */
export function one(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function pct(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
}

/** A sample CSV, so the import page can say what a file should look like. */
export function exampleCsv(spec: Pick<DomainSpec, "fields" | "titleField" | "noun">): string {
  const fields = spec.fields.filter((f) => f.type !== "json");
  const header = [...fields.map((f) => f.label), "Quantity", "Paid", "Location", "Notes"];
  const row = fields.map((f) => {
    if (f.type === "enum" && f.options) return Object.keys(f.options)[0] ?? "";
    if (f.type === "boolean") return "no";
    if (f.type === "integer" || f.type === "number") return f.min !== undefined ? String(f.min) : "1";
    if (f.type === "date") return "2024-01-15";
    if (f.type === "list") return "a; b";
    return f.key === spec.titleField ? `Example ${spec.noun.singular}` : "";
  });
  return `${header.join(",")}\n${[...row, "1", "25", "Shelf A", ""].join(",")}`;
}

export function Heading({ title, note, children }: { title: string; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">{title}</h1>
        {note && (
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {note}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}

export function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card-surface p-3">
      <p className="label mb-0.5">{label}</p>
      <p className="hero-figure text-xl">{value}</p>
      {note && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

export function Table({ headers, rows, footer }: { headers: string[]; rows: Array<Array<React.ReactNode>>; footer?: Array<React.ReactNode> }) {
  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: "var(--muted)" }}>
            {headers.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t" style={{ borderColor: "var(--line)" }}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t-2" style={{ borderColor: "var(--line-strong)" }}>
              {footer.map((cell, j) => (
                <td key={j} className="px-3 py-2 font-medium">
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display mb-2 text-lg font-semibold uppercase tracking-wide">{children}</h2>;
}
