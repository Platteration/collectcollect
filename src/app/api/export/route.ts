import { latestSnapshotsByCard, listCards } from "@/lib/cards";
import { GAMES } from "@/lib/types";

const COLUMNS = [
  "id", "game", "sport", "name", "set", "set_code", "number", "year", "rarity", "variant", "language", "manufacturer",
  "quantity", "condition", "grading_company", "grade", "cert_number", "grading_status", "purchase_price",
  "value_each", "value_total", "ungraded_price", "psa_10_price", "psa_10_estimate", "price_source", "price_date", "notes",
] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection: a leading = + - @ or tab/CR would be evaluated by Excel/Sheets.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET — the whole collection as CSV, with the latest price per card. */
export async function GET() {
  const cards = listCards();
  const prices = latestSnapshotsByCard();
  const lines = [COLUMNS.join(",")];
  for (const c of cards) {
    const s = prices.get(c.id)?.summary;
    const each = s?.yourCopyValue ?? null;
    lines.push(
      [
        c.id, GAMES[c.game], c.sport, c.name, c.setName, c.setCode, c.cardNumber, c.year, c.rarity, c.variant, c.language, c.manufacturer,
        c.quantity, c.grade ? "" : c.condition, c.gradingCompany, c.grade, c.certNumber, c.grade ? "" : c.gradingStatus, c.purchasePrice,
        each, each === null ? null : Math.round(each * c.quantity * 100) / 100, s?.ungraded ?? null,
        s?.graded["PSA 10"] ?? null, s?.estimatedGraded["PSA 10"] ?? null, s?.ungradedSource ?? null, s?.fetchedAt ?? null, c.notes,
      ]
        .map(cell)
        .join(","),
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="collectcollect-${date}.csv"`,
    },
  });
}
