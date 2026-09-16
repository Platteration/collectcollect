import type Database from "better-sqlite3";

/** Read portable Markdown history from an explicit snapshot, never global app state. */
export function snapshotHistory(db: Database.Database, owner: "card" | "item", id: number) {
  const column = `${owner}_id`;
  const property = `${owner}Id`;
  const sales = db.prepare(`SELECT id, ${column} AS ${property}, quantity, unit_price AS unitPrice, fees,
    unit_cost AS unitCost, sold_at AS soldAt, venue, notes, created_at AS createdAt
    FROM sales WHERE ${column} = ? ORDER BY sold_at DESC, id DESC`).all(id);
  const acquisitions = db.prepare(`SELECT id, ${column} AS ${property}, quantity, remaining, unit_cost AS unitCost,
    acquired_at AS acquiredAt, source, notes, created_at AS createdAt
    FROM acquisitions WHERE ${column} = ? ORDER BY acquired_at, id`).all(id);
  const snapshots = (db.prepare(`SELECT id, ${column} AS ${property}, fetched_at AS fetchedAt, summary
    FROM price_snapshots WHERE ${column} = ? ORDER BY fetched_at DESC, id DESC`).all(id) as Array<Record<string, unknown>>)
    .flatMap((row) => { try { return [{ ...row, summary: JSON.parse(String(row.summary)) as unknown }]; } catch { return []; } });
  const rows = db.prepare(`SELECT sl.sale_id AS saleId, sl.quantity, sl.unit_cost AS unitCost, a.acquired_at AS acquiredAt
    FROM sale_lots sl JOIN sales s ON s.id = sl.sale_id LEFT JOIN acquisitions a ON a.id = sl.acquisition_id
    WHERE s.${column} = ? ORDER BY sl.id`).all(id) as Array<{ saleId: number; quantity: number; unitCost: number | null; acquiredAt: string | null }>;
  const saleLots = new Map<number, Array<{ quantity: number; unitCost: number | null; acquiredAt: string | null }>>();
  for (const { saleId, ...lot } of rows) {
    const list = saleLots.get(saleId) ?? [];
    list.push(lot);
    saleLots.set(saleId, list);
  }
  return { sales, acquisitions, snapshots, saleLots };
}
