import { building, databaseExists, getDb } from "./db";
import { money } from "@collectcollect/core/format";
import { proceedsByMarket } from "./pricing/index";
import type { Alert, AlertKind, ItemRecord, PriceSummary, Settings } from "./types";

/**
 * Things worth telling the owner about.
 *
 * Each one has to be something they could act on, and each one has to be true
 * of *their* copy. An alert that fires on noise gets ignored, and an ignored
 * alert feed is worse than none: it teaches people not to look.
 */

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
  return {
    id: r.id,
    kind: r.kind as AlertKind,
    itemId: r.item_id,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

export interface AlertInput {
  kind: AlertKind;
  itemId: number | null;
  title: string;
  body: string;
}

export function createAlert(input: AlertInput): Alert {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare("INSERT INTO alerts (kind, item_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.kind, input.itemId, input.title, input.body, now);
  return { id: Number(result.lastInsertRowid), ...input, createdAt: now, readAt: null };
}

export function listAlerts(limit = 100): Alert[] {
  return (
    getDb().prepare("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT ?").all(limit) as AlertRow[]
  ).map(rowToAlert);
}

/**
 * How many alerts have not been read.
 *
 * The header asks for this on every page, which makes it the one database call
 * that reaches a build: Next prerenders the not-found page, and this layout
 * comes with it. So it does not ask while building, and it does not ask about
 * a collection that is not there — an inventory that does not exist has no
 * unread alerts. A real read that fails is still not worth a blank page.
 */
export function unreadCount(): number {
  if (building() || !databaseExists()) return 0;
  try {
    return (getDb().prepare("SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL").get() as { n: number }).n;
  } catch {
    return 0;
  }
}

export function markAllRead(): number {
  return getDb().prepare("UPDATE alerts SET read_at = ? WHERE read_at IS NULL").run(new Date().toISOString()).changes;
}

export function dismissAlert(id: number): boolean {
  return getDb().prepare("DELETE FROM alerts WHERE id = ?").run(id).changes > 0;
}

/** How long a webhook gets to answer before the alert is given up as delivered-or-not. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Post an alert to the owner's webhook, if they set one.
 *
 * Never allowed to fail an operation: this runs after a price refresh has
 * already been recorded, and a webhook that is down must not undo it. Nor is
 * it allowed to hang one: a webhook that never answers is cut off after ten
 * seconds. Either way the failure is logged, since an alert that silently
 * never arrived is the one kind of alert worse than none.
 */
export async function deliver(alert: Alert, settings: Settings, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!settings.alertWebhookUrl) return false;
  try {
    const res = await fetchImpl(settings.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: alert.kind, title: alert.title, body: alert.body, itemId: alert.itemId, at: alert.createdAt }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[alerts] webhook returned HTTP ${res.status} for "${alert.title}"`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[alerts] webhook failed for "${alert.title}":`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * What a refresh of one item is worth saying, given what it used to be worth.
 *
 * Nothing fires without a previous value to compare against: the first price an
 * item ever gets is not a move.
 */
export function alertsForRefresh(
  item: ItemRecord,
  previous: PriceSummary | null,
  next: PriceSummary,
  settings: Settings,
): AlertInput[] {
  const out: AlertInput[] = [];

  const before = previous?.yourCopyValue ?? null;
  const after = next.yourCopyValue ?? null;
  if (before !== null && after !== null && before > 0) {
    const change = ((after - before) / before) * 100;
    if (Math.abs(change) >= settings.alertMovePercent) {
      const up = change > 0;
      out.push({
        kind: "price_move",
        itemId: item.id,
        title: `${item.marketHashName} is ${up ? "up" : "down"} ${Math.abs(change).toFixed(0)}%`,
        body:
          `${money(before)} → ${money(after)}${item.quantity > 1 ? ` each, across ${item.quantity} copies` : ""}. ` +
          `${next.marketSource ?? "No source"} is the highest right now.`,
      });
    }
  }

  // The spread only matters where an owner could act on it, so it is measured
  // between cash markets — a Steam listing that pays more in wallet funds is
  // not more money.
  const { cash } = proceedsByMarket(next.quotes, settings);
  const best = cash[0];
  const worst = cash[cash.length - 1];
  if (cash.length >= 2 && best && worst) {
    const gap = best.net - worst.net;
    const percent = worst.net > 0 ? (gap / worst.net) * 100 : 0;
    if (gap >= settings.spreadMinAmount && percent >= settings.spreadMinPercent) {
      out.push({
        kind: "spread_opened",
        itemId: item.id,
        title: `${item.marketHashName} is worth ${money(gap)} more on ${best.label}`,
        body:
          `${best.label} nets ${money(best.net)} against ${worst.label}'s ${money(worst.net)}, after fees.` +
          (item.tradableAfter && new Date(item.tradableAfter) > new Date()
            ? ` It is trade locked until ${item.tradableAfter.slice(0, 10)}, so this cannot be acted on yet.`
            : ""),
      });
    }
  }

  return out;
}

/**
 * Items whose trade lock has lifted since the last time this was asked.
 *
 * Worth its own alert because a lock is the one thing that makes an otherwise
 * actionable spread unactionable, and the moment it ends is invisible: nothing
 * about the item changes, the date simply passes.
 */
export function alertsForTradeLocks(items: ItemRecord[], now = new Date()): AlertInput[] {
  const db = getDb();
  const already = new Set(
    (db.prepare("SELECT item_id FROM alerts WHERE kind = 'trade_lock_lifted'").all() as Array<{ item_id: number | null }>)
      .map((r) => r.item_id)
      .filter((id): id is number => id !== null),
  );
  return items
    .filter((item) => item.tradableAfter !== null && new Date(item.tradableAfter) <= now && !already.has(item.id))
    .map((item) => ({
      kind: "trade_lock_lifted" as const,
      itemId: item.id,
      title: `${item.marketHashName} can be traded again`,
      body: `Its trade lock ended on ${item.tradableAfter!.slice(0, 10)}.`,
    }));
}
