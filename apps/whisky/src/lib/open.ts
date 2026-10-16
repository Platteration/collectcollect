import type { Engine } from "@collectcollect/core/domain/engine";
import type { ItemInput, ItemRecord, NormalizedItem, PriceSnapshot } from "@collectcollect/core/domain/spec";
import type { SimpleExtras } from "@collectcollect/core/domain/pricing/index";
import type { Bottle, BottleSettings, BottleQuery } from "./types";

type BottleEngine = Engine<Bottle, BottleSettings, SimpleExtras, BottleQuery>;

/**
 * Opening a bottle.
 *
 * Once a bottle is open it is no longer an investment: its value is frozen
 * at what it was worth that day, it leaves the portfolio total, and it
 * becomes one specific object (this bottle, at this fill level) rather than
 * one of a stack. The rule lives in two places: the update hook, which
 * catches "sealed" being switched off on any bottle, and `openBottle`,
 * which takes one copy off a sealed stack and makes it a bottle of its own,
 * with the cost of the oldest copy still held, so the stack's cost basis
 * and quantity stay right.
 */

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Freeze the value the moment a bottle stops being sealed; thaw it if that was a mistake. */
export function onUpdate(existing: ItemRecord<Bottle>, next: NormalizedItem<Bottle>, ctx: { latestSnapshot(): PriceSnapshot<SimpleExtras> | null }): NormalizedItem<Bottle> {
  const out = { ...next };
  if (existing.sealed && !out.sealed) {
    out.openedAt = out.openedAt ?? today();
    if (out.frozenValue === null) {
      const manual = existing.manualValue !== null && existing.manualValue > 0 ? existing.manualValue : null;
      out.frozenValue = manual ?? ctx.latestSnapshot()?.summary.yourCopyValue ?? null;
    }
    // An opened bottle is one bottle; the other copies stay sealed in their own row (see openBottle).
    out.quantity = Math.min(out.quantity, 1);
    if (out.fillLevel === null) out.fillLevel = 100;
  }
  if (!existing.sealed && out.sealed) {
    out.openedAt = null;
    out.frozenValue = null;
    out.fillLevel = null;
  }
  return out;
}

/**
 * Take one copy off a sealed stack and open it. A stack of one is simply
 * opened in place. Returns the opened bottle.
 */
export function openBottle(engine: BottleEngine, itemId: number, opts: { fillLevel?: number | null; at?: string } = {}): ItemRecord<Bottle> {
  const { repo, ledger, db } = engine;
  const run = db.getDb().transaction((): ItemRecord<Bottle> => {
    const stack = repo.getItem(itemId);
    if (!stack) throw new Error("Bottle not found");
    if (!stack.sealed) throw new Error("This bottle is already open");
    const at = opts.at ?? today();
    const fillLevel = opts.fillLevel ?? 100;
    if (stack.quantity <= 1) {
      return repo.updateItem(itemId, { sealed: false, openedAt: at, fillLevel })!;
    }
    // The opened copy costs what the oldest copy still held cost, and takes the stack's current value with it.
    const value = engine.valuation(stack, repo.latestSnapshot(itemId)).value;
    const { unitCost } = ledger.consumeFifo(itemId, 1);
    ledger.syncQuantityFromLots(itemId);
    const input: ItemInput<Bottle> = {
      distillery: stack.distillery,
      expression: stack.expression,
      ageStatement: stack.ageStatement,
      vintage: stack.vintage,
      bottlingYear: stack.bottlingYear,
      caskType: stack.caskType,
      abv: stack.abv,
      bottleSize: stack.bottleSize,
      bottleNumber: stack.bottleNumber,
      region: stack.region,
      packaging: stack.packaging,
      sealed: false,
      openedAt: at,
      fillLevel,
      frozenValue: value,
      quantity: 1,
      purchasePrice: unitCost,
      location: stack.location,
      notes: stack.notes,
      photos: stack.photos,
      referenceImageUrl: stack.referenceImageUrl,
      accentColor: stack.accentColor,
      externalIds: stack.externalIds,
      manualValue: null,
    };
    const opened = repo.createItem(input);
    const latest = repo.latestSnapshot(itemId);
    if (latest) repo.addSnapshot(opened.id, { ...latest.summary, fetchedAt: latest.fetchedAt });
    repo.refreshMirror(itemId);
    return repo.getItem(opened.id)!;
  });
  try {
    const opened = run();
    repo.flushDeferredMirror();
    return opened;
  } catch (e) {
    repo.discardDeferredMirror();
    throw e;
  }
}
