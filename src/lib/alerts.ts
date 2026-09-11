import { getDb } from "./db";
import { gradingVerdict, isReadyToGrade, outlookSeries } from "./analytics";
import { money } from "./format";
import { outboundRefusal } from "./net";
import type { Alert, AlertKind, CardRecord, PriceSnapshot, PriceSummary, Settings } from "./types";

interface AlertRow {
  id: number;
  kind: string;
  card_id: number | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

const rowToAlert = (r: AlertRow): Alert => ({
  id: r.id,
  // Not narrowed to an AlertKind and not cast to one either: a restored row can
  // hold any string, and the list that renders it is the list it has to be
  // dismissed from, so it must render rather than throw. See ALERT_KINDS.
  kind: r.kind,
  cardId: r.card_id,
  title: r.title,
  body: r.body,
  createdAt: r.created_at,
  readAt: r.read_at,
});

export interface NewAlert {
  kind: AlertKind;
  cardId: number | null;
  title: string;
  body: string;
}

export function createAlert(alert: NewAlert): Alert {
  const id = getDb()
    .prepare("INSERT INTO alerts (kind, card_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(alert.kind, alert.cardId, alert.title, alert.body, new Date().toISOString()).lastInsertRowid;
  return rowToAlert(getDb().prepare("SELECT * FROM alerts WHERE id = ?").get(Number(id)) as AlertRow);
}

export function listAlerts(limit = 100): Alert[] {
  return (getDb().prepare("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT ?").all(limit) as AlertRow[]).map(rowToAlert);
}

export function unreadCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL").get() as { n: number };
  return row.n;
}

export function markAllRead(): number {
  return getDb().prepare("UPDATE alerts SET read_at = ? WHERE read_at IS NULL").run(new Date().toISOString()).changes;
}

export function deleteAlert(id: number): boolean {
  return getDb().prepare("DELETE FROM alerts WHERE id = ?").run(id).changes > 0;
}

/**
 * Decide what is worth telling the owner about after a card is re-priced.
 * Pure, so the thresholds can be tested without a database.
 */
export function alertsForRefresh(
  card: Pick<CardRecord, "id" | "name" | "grade" | "gradingCompany" | "identification" | "quantity">,
  previous: PriceSummary | null,
  next: PriceSummary,
  history: PriceSnapshot[],
  settings: Settings,
): NewAlert[] {
  const out: NewAlert[] = [];
  // Nothing to say about a card the owner no longer holds.
  if (card.quantity <= 0) return out;

  // A meaningful move in what this copy is worth.
  const before = previous?.yourCopyValue ?? null;
  const after = next.yourCopyValue ?? null;
  if (before && after && settings.alertMovePercent > 0) {
    const pct = ((after - before) / before) * 100;
    if (Math.abs(pct) >= settings.alertMovePercent) {
      out.push({
        kind: "price_move",
        cardId: card.id,
        title: `${card.name} ${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}%`,
        body: `Your copy moved from ${money(before)} to ${money(after)} since the last refresh.`,
      });
    }
  }

  // Real graded sales replacing an estimate is worth knowing: the outlook stops being a guess.
  const hadReal = previous ? Object.keys(previous.graded).length > 0 : false;
  const hasReal = Object.keys(next.graded).length > 0;
  if (!hadReal && hasReal && !card.grade) {
    const psa10 = next.graded["PSA 10"];
    out.push({
      kind: "graded_data",
      cardId: card.id,
      title: `Real graded prices for ${card.name}`,
      body: psa10
        ? `A source now reports ${money(psa10)} for a PSA 10, so the grading outlook is based on sales rather than a multiplier.`
        : `A source now reports graded prices, so the grading outlook is based on sales rather than a multiplier.`,
    });
  }

  // Newly worth sending in.
  if (!card.grade) {
    const assess = card.identification?.condition_assessment ?? null;
    const expected = assess?.estimated_grade_high ?? assess?.estimated_grade_low ?? null;
    const before1 = outlookSeries(history, settings, expected);
    // The provisional snapshot is not stored yet; give it an id that sorts last
    // so it lands at the end even when its timestamp ties with the previous one.
    const provisional = { id: Number.MAX_SAFE_INTEGER, cardId: card.id, fetchedAt: next.fetchedAt, summary: next };
    const after1 = outlookSeries([...history, provisional], settings, expected);
    const wasReady = isReadyToGrade(before1, gradingVerdict(before1), settings);
    const isReady = isReadyToGrade(after1, gradingVerdict(after1), settings);
    const last = after1[after1.length - 1];
    if (!wasReady && isReady && last) {
      out.push({
        kind: "ready_to_grade",
        cardId: card.id,
        title: `${card.name} looks ready to grade`,
        body: `A ${last.maxLabel} would be worth ${money(last.max)} against ${money(last.raw)} raw, about ${money(last.upside)} after the ${money(last.fee)} fee.`,
      });
    }
  }

  return out;
}

/**
 * Best-effort webhook delivery so alerts can reach email or push through a
 * service the owner controls. Failures are logged, never thrown: a broken
 * webhook must not break a price refresh.
 *
 * The webhook is meant for an external forwarding service, so the address it
 * resolves to is checked first and a redirect is refused rather than followed:
 * otherwise the setting is a way to make this server POST an attacker-shaped
 * body to anything it can reach, including whatever is listening on loopback.
 */
export async function deliver(alert: Alert, settings: Settings): Promise<void> {
  if (!settings.alertWebhookUrl) return;
  const refusal = await outboundRefusal(settings.alertWebhookUrl);
  if (refusal) {
    console.error(`[alerts] webhook not sent: ${refusal}`);
    return;
  }
  try {
    const res = await fetch(settings.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: alert.kind, title: alert.title, body: alert.body, cardId: alert.cardId, createdAt: alert.createdAt }),
      signal: AbortSignal.timeout(10_000),
      // A 302 into a private address would undo the check above.
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) console.error("[alerts] webhook redirected; give the final URL instead");
    else if (!res.ok) console.error(`[alerts] webhook returned HTTP ${res.status}`);
  } catch (e) {
    console.error("[alerts] webhook failed", e instanceof Error ? e.message : e);
  }
}
