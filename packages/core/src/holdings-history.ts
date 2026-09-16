import type Database from "better-sqlite3";

interface HistorySpec { table: string; foreignKey: string; name: string; manualPrice?: string; rawField?: string }
const identifier = (s: string) => {
  if (!/^[a-z_]+$/.test(s)) throw new Error("Invalid history identifier");
  return s;
};

/** An append-only record of what the app knew, starting at an explicit opening balance.
 * SQL triggers make imports, corrections and ordinary writes participate in the
 * same transaction. There are deliberately no cascading foreign keys here.
 */
export function initializeHoldingsHistory(db: Database.Database, spec: HistorySpec): void {
  const table = identifier(spec.table), fk = identifier(spec.foreignKey), name = identifier(spec.name);
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const summary = (id: string) => `(SELECT summary FROM price_snapshots WHERE ${fk}=${id} ORDER BY fetched_at DESC,id DESC LIMIT 1)`;
  const quoted = (id: string, field: string) => `json_extract(${summary(id)}, '$.${identifier(field)}')`;
  // JSON keys use camel case; keep the paths constant rather than interpolating user input.
  const value = (row: string) => spec.manualPrice
    ? `COALESCE(${row}.${identifier(spec.manualPrice)}, json_extract(${summary(`${row}.id`)}, '$.yourCopyValue'))`
    : `json_extract(${summary(`${row}.id`)}, '$.yourCopyValue')`;
  const raw = (row: string) => spec.rawField ? quoted(`${row}.id`, spec.rawField) : "NULL";
  db.exec(`
    CREATE TABLE IF NOT EXISTS holdings_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL,
      name TEXT NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL,
      quantity INTEGER NOT NULL, unit_value REAL, raw_unit_value REAL
    );
    CREATE INDEX IF NOT EXISTS idx_holdings_events_entity ON holdings_events(entity_id,id);
  `);
  const started = db.prepare("SELECT value FROM settings WHERE key='holdings_history_started'").get();
  if (!started) {
    db.exec(`INSERT INTO settings(key,value) VALUES('holdings_history_started',${now});
      INSERT INTO holdings_events(entity_id,name,kind,recorded_at,quantity,unit_value,raw_unit_value)
      SELECT c.id,c.${name},'opening',(SELECT value FROM settings WHERE key='holdings_history_started'),c.quantity,${value("c")},${raw("c")} FROM ${table} c;`);
  }
  const record = (kind: string, row: string, qty = `${row}.quantity`) => `
    INSERT INTO holdings_events(entity_id,name,kind,recorded_at,quantity,unit_value,raw_unit_value)
    VALUES(${row}.id,${row}.${name},'${kind}',${now},${qty},${value(row)},${raw(row)});`;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS history_entity_insert AFTER INSERT ON ${table} BEGIN ${record("added", "NEW")} END;
    CREATE TRIGGER IF NOT EXISTS history_entity_update AFTER UPDATE ON ${table}
      WHEN OLD.quantity IS NOT NEW.quantity OR OLD.${name} IS NOT NEW.${name}${spec.manualPrice ? ` OR OLD.${identifier(spec.manualPrice)} IS NOT NEW.${identifier(spec.manualPrice)}` : ""}
      BEGIN ${record("holding_changed", "NEW")} END;
    CREATE TRIGGER IF NOT EXISTS history_entity_delete BEFORE DELETE ON ${table} BEGIN ${record("removed", "OLD", "0")} END;
    CREATE TRIGGER IF NOT EXISTS history_snapshot_insert AFTER INSERT ON price_snapshots BEGIN
      INSERT INTO holdings_events(entity_id,name,kind,recorded_at,quantity,unit_value,raw_unit_value)
      SELECT c.id,c.${name},'price',${now},c.quantity,${value("c")},${raw("c")} FROM ${table} c WHERE c.id=NEW.${fk};
    END;
  `);
  // A booked purchase, sale, or reversal remains visible even if its mutable
  // operational record is later corrected or undone.
  for (const [source, event, timing] of [["acquisitions", "purchase", "INSERT"], ["sales", "sale", "INSERT"], ["sales", "sale_reversal", "DELETE"]] as const) {
    const row = timing === "DELETE" ? "OLD" : "NEW";
    db.exec(`CREATE TRIGGER IF NOT EXISTS history_${event} AFTER ${timing} ON ${source} BEGIN
      INSERT INTO holdings_events(entity_id,name,kind,recorded_at,quantity,unit_value,raw_unit_value)
      SELECT c.id,c.${name},'${event}',${now},c.quantity,${value("c")},${raw("c")} FROM ${table} c WHERE c.id=${row}.${fk}; END;`);
  }
}

export interface HoldingsPoint { t: string; value: number; ungraded: number; priced: number; unpriced: number }
export function holdingsHistory(db: Database.Database): { startedAt: string; points: HoldingsPoint[] } {
  const started = db.prepare("SELECT value FROM settings WHERE key='holdings_history_started'").get() as { value: string };
  const rows = db.prepare("SELECT entity_id,recorded_at,quantity,unit_value,raw_unit_value FROM holdings_events ORDER BY id").all() as
    Array<{ entity_id: number; recorded_at: string; quantity: number; unit_value: number | null; raw_unit_value: number | null }>;
  const state = new Map<number, { value: number; raw: number; priced: number; unpriced: number }>();
  let value = 0, raw = 0, priced = 0, unpriced = 0;
  const points: HoldingsPoint[] = [{ t: started.value, value: 0, ungraded: 0, priced: 0, unpriced: 0 }];
  for (const row of rows) {
    const before = state.get(row.entity_id) ?? { value: 0, raw: 0, priced: 0, unpriced: 0 };
    const held = row.quantity > 0;
    const after = { value: (row.unit_value ?? 0) * row.quantity, raw: (row.raw_unit_value ?? 0) * row.quantity,
      priced: held && row.unit_value !== null ? 1 : 0, unpriced: held && row.unit_value === null ? 1 : 0 };
    value += after.value - before.value; raw += after.raw - before.raw;
    priced += after.priced - before.priced; unpriced += after.unpriced - before.unpriced;
    state.set(row.entity_id, after);
    const point = { t: row.recorded_at, value: Math.round(value * 100) / 100, ungraded: Math.round(raw * 100) / 100, priced, unpriced };
    if (points.at(-1)?.t === point.t) points[points.length - 1] = point; else points.push(point);
  }
  return { startedAt: started.value, points };
}
