import { getDb } from "./db";
import { getLot, recomputePurchasePrice, type Acquisition } from "./acquisitions";
import { refreshMirror } from "./cards";
import { MAX_MONEY } from "./types";

export class LotEditError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
export type LotEditable = Pick<Acquisition, "unitCost" | "acquiredAt" | "source" | "notes">;
export type LotEditInput = Partial<LotEditable> & { expected?: LotEditable & { quantity: number; remaining: number } };

export function correctLot(cardId: number, lotId: number, patch: LotEditInput): Acquisition {
  const db = getDb();
  const lot = db.transaction(() => {
    const current = getLot(lotId);
    if (!current || current.cardId !== cardId) throw new LotEditError("Purchase not found", 404);
    if (!patch || typeof patch !== "object") throw new LotEditError("Expected purchase details");
    if ("quantity" in patch || "remaining" in patch) throw new LotEditError("Use the inventory count correction to change quantities.");
    const expected = patch.expected;
    if (!expected || (["unitCost", "acquiredAt", "source", "notes", "quantity", "remaining"] as const).some((key) => expected[key] !== current[key])) {
      throw new LotEditError("This purchase changed. Reload it before saving.", 409);
    }
    const cost = patch.unitCost === undefined ? current.unitCost : patch.unitCost;
    if (cost !== null && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > MAX_MONEY)) throw new LotEditError("Cost must be a number from zero to " + MAX_MONEY);
    const acquiredAt = patch.acquiredAt === undefined ? current.acquiredAt : patch.acquiredAt;
    if (typeof acquiredAt !== "string" || !Number.isFinite(new Date(acquiredAt).getTime())) throw new LotEditError("Acquisition date is not valid");
    const sold = current.remaining !== current.quantity || Boolean(db.prepare("SELECT 1 FROM sale_lots WHERE acquisition_id=? LIMIT 1").get(lotId));
    if (sold && (cost !== current.unitCost || new Date(acquiredAt).toISOString() !== current.acquiredAt)) throw new LotEditError("Copies from this purchase have been sold. Undo those sales before changing its cost or date.", 409);
    const text = (value: unknown, fallback: string | null) => {
      if (value === undefined) return fallback;
      if (value === null) return null;
      if (typeof value !== "string" || value.length > 4000) throw new LotEditError("Purchase notes and source must be text of at most 4000 characters");
      return value.trim() || null;
    };
    db.prepare("UPDATE acquisitions SET unit_cost=?, acquired_at=?, source=?, notes=? WHERE id=?")
      .run(cost, new Date(acquiredAt).toISOString(), text(patch.source, current.source), text(patch.notes, current.notes), lotId);
    recomputePurchasePrice(cardId);
    return getLot(lotId)!;
  })();
  refreshMirror(cardId);
  return lot;
}
