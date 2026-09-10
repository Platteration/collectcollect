import type { DomainSpec, ItemRecord, SaleWithItem, Valuation } from "../spec";
import { columnOf, optionLabel } from "../spec";
import { visibleFields } from "../markdown/document";

/**
 * The collection as a spreadsheet, in the column names the importer reads
 * back, so an export is also a starting point for filling in what you paid.
 */

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection: a leading = + - @ or tab/CR would be evaluated by Excel or Sheets.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fieldCell(field: { type: string; options?: Record<string, string> }, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case "boolean":
      return value ? "yes" : "";
    case "enum":
      return optionLabel(field as never, value);
    case "list":
      return Array.isArray(value) ? value.join("; ") : String(value);
    case "json":
      return JSON.stringify(value);
    default:
      return value;
  }
}

export function itemsCsv<F extends object, X extends object>(
  spec: Pick<DomainSpec<F, object, X>, "fields">,
  items: ItemRecord<F>[],
  valueOf: (item: ItemRecord<F>) => Valuation & { at: string | null },
  includePrivate: boolean,
): string {
  const fields = visibleFields(spec, includePrivate);
  const columns = ["id", ...fields.map((f) => columnOf(f.key)), "quantity", "cost", "location", "value_each", "value_total", "basis", "price_date", "notes"];
  const lines = [columns.join(",")];
  for (const item of items) {
    const values = item as unknown as Record<string, unknown>;
    const { value, basis, at } = valueOf(item);
    lines.push(
      [
        item.id,
        ...fields.map((f) => fieldCell(f, values[f.key])),
        item.quantity,
        item.purchasePrice,
        item.location,
        value,
        value === null ? null : Math.round(value * item.quantity * 100) / 100,
        basis,
        at,
        item.notes,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export function salesCsv(sales: SaleWithItem[]): string {
  const columns = ["sale_id", "item_id", "name", "detail", "sold_at", "quantity", "unit_price", "fees", "net", "unit_cost", "gain", "venue", "notes"];
  const lines = [columns.join(",")];
  for (const s of sales) {
    const net = Math.round((s.unitPrice * s.quantity - s.fees) * 100) / 100;
    const gain = s.unitCost === null ? null : Math.round((net - s.unitCost * s.quantity) * 100) / 100;
    lines.push([s.id, s.itemId, s.itemName, s.itemDetail, s.soldAt, s.quantity, s.unitPrice, s.fees, net, s.unitCost, gain, s.venue, s.notes].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
