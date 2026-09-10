import type { Engine } from "./engine";

/**
 * Load a spec's sample data into an empty collection: each example becomes an
 * item with a purchase lot behind it and, when it says so, a run of past
 * values so the chart has a line to draw on first run.
 */
export function loadSeed<F extends object, S extends object, X extends object, Q>(engine: Engine<F, S, X, Q>): number {
  const seed = engine.spec.seed ?? [];
  if (seed.length === 0) return 0;
  if (engine.repo.countItems() > 0) throw new Error("Sample data only loads into an empty collection");
  let created = 0;
  for (const entry of seed) {
    const item = engine.repo.createItem(entry.input);
    created++;
    if (entry.lot) {
      // createItem already opened a lot for the copies held; replace it with the one described.
      for (const lot of engine.ledger.listLots(item.id)) engine.ledger.deleteLot(lot.id);
      engine.ledger.addLot(item.id, {
        quantity: entry.lot.quantity ?? item.quantity,
        unitCost: entry.lot.unitCost === undefined ? item.purchasePrice : entry.lot.unitCost,
        acquiredAt: entry.lot.acquiredAt,
        source: entry.lot.source ?? "sample data",
        notes: entry.lot.notes ?? null,
      });
      engine.ledger.syncQuantityFromLots(item.id);
      engine.repo.refreshMirror(item.id);
    }
    for (const point of entry.history ?? []) {
      engine.refresh.addManualSnapshot(item.id, { value: point.value, at: point.at, note: point.note ?? "Sample value" });
    }
  }
  engine.mirror.flushCollection();
  return created;
}
