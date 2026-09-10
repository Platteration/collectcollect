import { latestSnapshotsByCard, listCards } from "@/lib/cards";
import { GAMES } from "@/lib/types";
import { listSales } from "@/lib/sales";

const COLUMNS = [
  "id", "game", "sport", "name", "set", "set_code", "number", "year", "rarity", "variant", "language", "manufacturer",
  "team", "rookie", "parallel", "serial_number", "autograph", "relic",
  "quantity", "condition", "grading_company", "grade", "cert_number", "centering", "corners", "edges", "surface", "grading_status", "purchase_price", "location",
  "value_each", "value_total", "ungraded_price", "psa_10_price", "psa_10_estimate", "price_source", "price_date", "notes",
] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection: a leading = + - @ or tab/CR would be evaluated by Excel/Sheets.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const SALE_COLUMNS = ["sale_id", "card_id", "game", "name", "detail", "sold_at", "quantity", "unit_price", "fees", "net", "unit_cost", "gain", "venue", "notes"] as const;

function salesCsv(): string {
  const lines = [SALE_COLUMNS.join(",")];
  for (const s of listSales()) {
    const net = Math.round((s.unitPrice * s.quantity - s.fees) * 100) / 100;
    const gain = s.unitCost === null ? null : Math.round((net - s.unitCost * s.quantity) * 100) / 100;
    lines.push(
      [s.id, s.cardId, GAMES[s.game], s.cardName, s.cardDetail, s.soldAt, s.quantity, s.unitPrice, s.fees, net, s.unitCost, gain, s.venue, s.notes]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** GET — the collection as CSV, or `?type=sales` for the sales ledger. */
export async function GET(request: Request) {
  const date = new Date().toISOString().slice(0, 10);
  if (new URL(request.url).searchParams.get("type") === "sales") {
    return new Response(salesCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="collectcollect-sales-${date}.csv"`,
      },
    });
  }
  const cards = listCards();
  const prices = latestSnapshotsByCard();
  const lines = [COLUMNS.join(",")];
  for (const c of cards) {
    const s = prices.get(c.id)?.summary;
    const each = s?.yourCopyValue ?? null;
    lines.push(
      [
        c.id, GAMES[c.game], c.sport, c.name, c.setName, c.setCode, c.cardNumber, c.year, c.rarity, c.variant, c.language, c.manufacturer,
        c.team, c.rookie ? "yes" : "", c.parallel, c.serialNumber, c.autograph ? "yes" : "", c.relic ? "yes" : "",
        c.quantity, c.grade ? "" : c.condition, c.gradingCompany, c.grade, c.certNumber,
        c.subgrades?.centering ?? null, c.subgrades?.corners ?? null, c.subgrades?.edges ?? null, c.subgrades?.surface ?? null,
        c.grade ? "" : c.gradingStatus, c.purchasePrice, c.location,
        each, each === null ? null : Math.round(each * c.quantity * 100) / 100, s?.ungraded ?? null,
        s?.graded["PSA 10"] ?? null, s?.estimatedGraded["PSA 10"] ?? null, s?.ungradedSource ?? null, s?.fetchedAt ?? null, c.notes,
      ]
        .map(cell)
        .join(","),
    );
  }
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="collectcollect-${date}.csv"`,
    },
  });
}
