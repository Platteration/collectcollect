import type { Auth } from "../auth";
import { createProxy } from "../proxy";
import { createAlerts } from "./alerts";
import { domainAuth } from "./auth";
import { createLedger } from "./acquisitions";
import { createBackup } from "./backup";
import { createCsvImport } from "./csv/import";
import { itemsCsv, salesCsv } from "./csv/export";
import { createDomainDb } from "./db";
import { createIdentifier } from "./identify";
import { createImages } from "./images";
import { createMirror } from "./markdown/mirror";
import { createRestore } from "./markdown/restore";
import { defaultValueOf } from "./pricing/index";
import { createRefresh } from "./pricing/refresh";
import { createRepository } from "./repository";
import { createSales } from "./sales";
import { createScheduler } from "./scheduler";
import { createSettings } from "./settings";
import type { DomainSpec, ItemRecord, PriceSnapshot, Valuation } from "./spec";
import { domainStatuses } from "./status";

/**
 * Everything an app needs, built from its spec. Nothing here opens the
 * database until something asks for it, so creating an engine at module load
 * is free and safe during a build.
 */
export function createEngine<F extends object, S extends object, X extends object, Q>(spec: DomainSpec<F, S, X, Q>) {
  const db = createDomainDb(spec);
  const ledger = createLedger(db.getDb);
  const settings = createSettings<S>(spec, db);
  const mirror = createMirror<F, S, X>({ spec: spec as DomainSpec<F, S, X, unknown>, db, ledger, includePrivate: () => settings.getSettings().exportPrivateFields });
  const repo = createRepository<F, S, X, Q>({ spec, db, ledger, mirror });
  const sales = createSales<F, X>({ spec, db, ledger, repo });
  const alerts = createAlerts(db);
  const refresh = createRefresh<F, S, X, Q>({ spec, repo, settings, alerts });
  const restore = createRestore<F, S, X>({ spec: spec as DomainSpec<F, S, X, unknown>, db, repo, ledger, mirror, settings: settings.getSettings });
  const csv = createCsvImport<F, X>({ spec, repo });
  const images = createImages(db);
  const identifier = spec.identify ? createIdentifier(spec.identify, images.prepareForVision) : null;
  const backup = createBackup<F>({ id: spec.id, db, images, mirror, rebuild: () => mirror.rebuildCollection(repo.listItems()) });
  const auth: Auth = domainAuth(spec.id, spec.envPrefix);
  const scheduler = createScheduler(spec.envPrefix, spec.id, (opts) => refresh.refreshAll(opts));

  /** What one copy is worth now, and why. */
  function valuation(item: ItemRecord<F>, snapshot: PriceSnapshot<X> | null | undefined): Valuation {
    return spec.valuation ? spec.valuation(item, snapshot) : defaultValueOf(item, snapshot);
  }

  /** Whether an item's value belongs in the portfolio total. */
  function counts(item: ItemRecord<F>): boolean {
    return item.quantity > 0 && !(spec.excludeFromPortfolio?.(item) ?? false);
  }

  function exportCsv(): string {
    const latest = repo.latestSnapshotsByItem();
    const includePrivate = settings.getSettings().exportPrivateFields;
    return itemsCsv<F, X>(
      spec,
      repo.listItems(),
      (item) => {
        const snapshot = latest.get(item.id);
        return { ...valuation(item, snapshot), at: snapshot?.fetchedAt ?? null };
      },
      includePrivate,
    );
  }

  return {
    spec,
    db,
    ledger,
    settings,
    mirror,
    repo,
    sales,
    alerts,
    refresh,
    restore,
    csv,
    images,
    identifier,
    backup,
    auth,
    proxy: (publicPaths: string[] = ["/login", "/api/auth"]) => createProxy(auth, publicPaths),
    scheduler,
    valuation,
    counts,
    exportCsv,
    exportSalesCsv: () => salesCsv(sales.listSales()),
    statuses: () => domainStatuses(spec.pricing.providers, Boolean(spec.identify), spec.noun.singular),
  };
}

export type Engine<F extends object = Record<string, unknown>, S extends object = Record<string, unknown>, X extends object = Record<string, unknown>, Q = unknown> = ReturnType<
  typeof createEngine<F, S, X, Q>
>;

/** Any engine, for code that does not care about the domain's own types. */
export type AnyEngine = Engine<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, unknown>;
