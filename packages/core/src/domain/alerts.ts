import type { DomainDb } from "./db";
import { money } from "../format";
import type { Alert, BaseSettings, NewAlert, PriceSummaryBase } from "./spec";

interface AlertRow {
  id: number;
  kind: string;
  item_id: number | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

function rowToAlert(r: AlertRow): Alert {
  return { id: r.id, kind: r.kind, itemId: r.item_id, title: r.title, body: r.body, createdAt: r.created_at, readAt: r.read_at };
}

export type Alerts = ReturnType<typeof createAlerts>;

/**
 * Things worth telling the owner about. Each one has to be something they
 * could act on, and true of their copy: an alert that fires on noise gets
 * ignored, and an ignored feed teaches people not to look.
 */
export function createAlerts(db: DomainDb) {
  const getDb = db.getDb;

  function createAlert(input: NewAlert): Alert {
    const now = new Date().toISOString();
    const result = getDb()
      .prepare("INSERT INTO alerts (kind, item_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.kind, input.itemId, input.title, input.body, now);
    return { id: Number(result.lastInsertRowid), ...input, createdAt: now, readAt: null };
  }

  function listAlerts(limit = 100): Alert[] {
    return (getDb().prepare("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT ?").all(limit) as AlertRow[]).map(rowToAlert);
  }

  /**
   * How many alerts have not been read. The header asks on every page, which
   * makes it the one database call that reaches a build, so it does not ask
   * while building and does not ask about a collection that is not there.
   */
  function unreadCount(): number {
    if (db.building() || !db.databaseExists()) return 0;
    try {
      return (getDb().prepare("SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL").get() as { n: number }).n;
    } catch {
      return 0;
    }
  }

  function markAllRead(): number {
    return getDb().prepare("UPDATE alerts SET read_at = ? WHERE read_at IS NULL").run(new Date().toISOString()).changes;
  }

  function dismissAlert(id: number): boolean {
    return getDb().prepare("DELETE FROM alerts WHERE id = ?").run(id).changes > 0;
  }

  /** Whether an alert of this kind already exists for the item, for one-off notices. */
  function hasAlert(kind: string, itemId: number): boolean {
    return Boolean(getDb().prepare("SELECT 1 FROM alerts WHERE kind = ? AND item_id = ? LIMIT 1").get(kind, itemId));
  }

  /**
   * Best-effort webhook delivery so alerts can reach email or push through a
   * service the owner controls. Never allowed to fail an operation.
   */
  async function deliver(alert: Alert, settings: BaseSettings, fetchImpl: typeof fetch = fetch): Promise<void> {
    if (!settings.alertWebhookUrl) return;
    try {
      const res = await fetchImpl(settings.alertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: alert.kind, title: alert.title, body: alert.body, itemId: alert.itemId, createdAt: alert.createdAt }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) console.error(`[alerts] webhook returned HTTP ${res.status}`);
    } catch (e) {
      console.error("[alerts] webhook failed", e instanceof Error ? e.message : e);
    }
  }

  return { createAlert, listAlerts, unreadCount, markAllRead, dismissAlert, hasAlert, deliver };
}

/** The one rule every domain shares: a meaningful move in what this copy is worth. */
export function priceMoveAlert(
  item: { id: number; quantity: number },
  title: string,
  previous: PriceSummaryBase | null,
  next: PriceSummaryBase,
  settings: BaseSettings,
): NewAlert | null {
  if (item.quantity <= 0) return null;
  const before = previous?.yourCopyValue ?? null;
  const after = next.yourCopyValue ?? null;
  if (before === null || after === null || before <= 0 || settings.alertMovePercent <= 0) return null;
  const pct = ((after - before) / before) * 100;
  if (Math.abs(pct) < settings.alertMovePercent) return null;
  return {
    kind: "price_move",
    itemId: item.id,
    title: `${title} ${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}%`,
    body: `Your copy moved from ${money(before)} to ${money(after)}${item.quantity > 1 ? ` each, across ${item.quantity} copies` : ""} since the last refresh.`,
  };
}

export const BASE_ALERT_KINDS: Record<string, { label: string; icon: string }> = {
  price_move: { label: "Price move", icon: "↕" },
};
