import { NextResponse } from "next/server";
import { createAuthRoutes } from "../auth-route";
import { errorMessage, jsonError, parseId } from "../http";
import { assertZippable, fileChunks, zipStream, type ZipEntry } from "../zip";
import type { Engine } from "./engine";
import { IdentifyError } from "./identify";
import { isValidUploadName } from "./normalize";
import { IMPORT_MAX_BYTES } from "./markdown/restore";
import { RESTORE_MAX_BYTES } from "./backup";
import type { ItemInput } from "./spec";
import type { SaleInput } from "./sales";
import type { AcquisitionInput } from "./acquisitions";
import { loadSeed } from "./seed";

/**
 * Every route handler an app needs, built once from its engine. An app's
 * route files re-export these, one line each, so the twenty-odd endpoints
 * are written once and behave the same in every collection.
 */

type Ctx = { params: Promise<Record<string, string>> };
type Params = Record<string, string>;

const MAX_UPLOADS = 20;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_CSV_BYTES = 8 * 1024 * 1024;

async function json<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function paramsOf(ctx: Ctx | undefined): Promise<Params> {
  return ctx ? await ctx.params : {};
}

export function createRoutes<F extends object, S extends object, X extends object, Q>(engine: Engine<F, S, X, Q>) {
  const { repo, sales, alerts, settings, refresh, restore, csv, images, backup, mirror, spec, ledger } = engine;
  const noun = spec.noun.singular;
  const notFound = () => jsonError(`${capitalize(noun)} not found`, 404);

  const items = {
    async GET(request: Request) {
      const url = new URL(request.url);
      const filters: Record<string, string> = {};
      for (const [key, value] of url.searchParams) if (key.startsWith("f_")) filters[key.slice(2)] = value;
      const location = url.searchParams.get("location");
      const list = repo.listItems({
        search: url.searchParams.get("q") ?? undefined,
        location: location === null ? undefined : location === "none" ? "" : location,
        filters,
        includeSold: url.searchParams.get("sold") !== "0",
      });
      const prices = repo.latestSnapshotsByItem();
      return NextResponse.json({ items: list.map((i) => ({ ...i, latestPrice: prices.get(i.id)?.summary ?? null })) });
    },
    async POST(request: Request) {
      const body = await json<ItemInput>(request);
      if (!body) return jsonError("Expected a JSON body");
      try {
        return NextResponse.json({ item: repo.createItem(body as ItemInput<F>) }, { status: 201 });
      } catch (e) {
        return jsonError(errorMessage(e));
      }
    },
  };

  const item = {
    async GET(_request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      const found = id ? repo.getItem(id) : null;
      if (!found) return notFound();
      return NextResponse.json({ item: found, latestPrice: repo.latestSnapshot(found.id)?.summary ?? null });
    },
    async PATCH(request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id) return notFound();
      const body = await json<ItemInput>(request);
      if (!body) return jsonError("Expected a JSON body");
      try {
        const updated = repo.updateItem(id, body as ItemInput<F>);
        if (!updated) return notFound();
        return NextResponse.json({ item: updated });
      } catch (e) {
        return jsonError(errorMessage(e));
      }
    },
    async DELETE(_request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      const found = id ? repo.getItem(id) : null;
      if (!found) return notFound();
      repo.deleteItem(found.id);
      for (const photo of found.photos) await images.deleteUpload(photo);
      return NextResponse.json({ ok: true });
    },
  };

  const itemPrice = {
    /** POST — ask every source again and record what they say. */
    async POST(_request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      const found = id ? repo.getItem(id) : null;
      if (!found) return notFound();
      try {
        const outcome = await refresh.refreshItem(found);
        return NextResponse.json({ item: outcome.item, snapshot: outcome.snapshot, summary: outcome.snapshot.summary, stored: outcome.stored });
      } catch (e) {
        return jsonError(`Could not price that: ${errorMessage(e)}`, 502);
      }
    },
    /** PUT — set or clear the owner's own value and keyed prices. */
    async PUT(request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id || !repo.getItem(id)) return notFound();
      const body = await json<{ manualValue?: unknown; manualPrices?: unknown }>(request);
      if (!body) return jsonError("Expected a JSON body");
      const patch: ItemInput<F> = {} as ItemInput<F>;
      if ("manualValue" in body) {
        const raw = body.manualValue;
        if (raw !== null && raw !== undefined && raw !== "") {
          const n = typeof raw === "number" ? raw : Number(raw);
          if (!Number.isFinite(n) || n < 0) return jsonError("A value has to be a number, or empty to clear it");
          patch.manualValue = n;
        } else patch.manualValue = null;
      }
      if ("manualPrices" in body) {
        if (body.manualPrices !== null && (typeof body.manualPrices !== "object" || Array.isArray(body.manualPrices))) return jsonError("Prices have to be a map of label to number");
        const prices: Record<string, number> = {};
        for (const [k, v] of Object.entries((body.manualPrices ?? {}) as Record<string, unknown>)) {
          if (k === "__proto__" || !k.trim()) continue;
          const n = typeof v === "number" ? v : Number(v);
          if (!Number.isFinite(n) || n < 0) return jsonError(`The price for ${k} has to be a number`);
          prices[k.trim()] = n;
        }
        patch.manualPrices = prices;
      }
      return NextResponse.json({ item: repo.updateItem(id, patch) });
    },
  };

  const itemPrices = {
    async GET(_request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id || !repo.getItem(id)) return notFound();
      return NextResponse.json({ snapshots: repo.listSnapshots(id, 200) });
    },
    /** POST — a value entered by hand as a point in the history. */
    async POST(request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id || !repo.getItem(id)) return notFound();
      const body = await json<{ value?: unknown; at?: unknown; note?: unknown }>(request);
      if (!body) return jsonError("Expected a JSON body");
      try {
        return NextResponse.json({ snapshot: refresh.addManualSnapshot(id, { value: body.value, at: body.at, note: body.note }) }, { status: 201 });
      } catch (e) {
        return jsonError(errorMessage(e));
      }
    },
  };

  const itemSales = {
    async GET(_request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id || !repo.getItem(id)) return notFound();
      return NextResponse.json({ sales: sales.listSalesForItem(id) });
    },
    async POST(request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id || !repo.getItem(id)) return notFound();
      const body = await json<SaleInput>(request);
      if (!body) return jsonError("Expected a JSON body");
      try {
        const sale = sales.recordSale(id, body);
        return NextResponse.json({ sale, item: repo.getItem(id) }, { status: 201 });
      } catch (e) {
        return jsonError(errorMessage(e));
      }
    },
  };

  const itemAcquisitions = {
    async GET(_request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id || !repo.getItem(id)) return notFound();
      return NextResponse.json({ acquisitions: ledger.listLots(id) });
    },
    async POST(request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id || !repo.getItem(id)) return notFound();
      const body = await json<AcquisitionInput>(request);
      if (!body) return jsonError("Expected a JSON body");
      try {
        const updated = repo.addAcquisition(id, body);
        if (!updated) return notFound();
        return NextResponse.json({ item: updated, acquisitions: ledger.listLots(id) }, { status: 201 });
      } catch (e) {
        return jsonError(errorMessage(e));
      }
    },
  };

  const lot = {
    async GET(_request: Request, ctx?: Ctx) {
      const params = await paramsOf(ctx);
      const lotId = parseId(params.lotId);
      const found = lotId ? ledger.getLot(lotId) : null;
      if (!found || found.itemId !== parseId(params.id)) return jsonError("Purchase not found", 404);
      return NextResponse.json({ acquisition: found });
    },
    async DELETE(_request: Request, ctx?: Ctx) {
      const params = await paramsOf(ctx);
      const id = parseId(params.id);
      const lotId = parseId(params.lotId);
      const found = lotId ? ledger.getLot(lotId) : null;
      if (!id || !found || found.itemId !== id) return jsonError("Purchase not found", 404);
      try {
        const updated = repo.removeAcquisition(found.id);
        if (!updated) return jsonError("Purchase not found", 404);
        return NextResponse.json({ item: updated, acquisitions: ledger.listLots(id) });
      } catch (e) {
        return jsonError(errorMessage(e), 409);
      }
    },
  };

  const intake = {
    async POST(request: Request) {
      const body = await json<ItemInput>(request);
      if (!body) return jsonError("Expected a JSON body");
      try {
        const outcome = repo.intakeItem(body as ItemInput<F>);
        return NextResponse.json(outcome, { status: outcome.result === "created" ? 201 : 200 });
      } catch (e) {
        return jsonError(errorMessage(e));
      }
    },
  };

  const salesRoute = {
    async GET() {
      const { realizedReturn } = await import("./analytics");
      const list = sales.listSales();
      return NextResponse.json({ sales: list, realized: realizedReturn(list) });
    },
  };

  const sale = {
    async DELETE(_request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id) return jsonError("Sale not found", 404);
      try {
        return sales.deleteSale(id) ? NextResponse.json({ ok: true }) : jsonError("Sale not found", 404);
      } catch (e) {
        return jsonError(errorMessage(e));
      }
    },
  };

  const alertsRoute = {
    async GET() {
      return NextResponse.json({ alerts: alerts.listAlerts(), unread: alerts.unreadCount() });
    },
    async POST() {
      return NextResponse.json({ marked: alerts.markAllRead(), unread: alerts.unreadCount() });
    },
  };

  const alert = {
    async DELETE(_request: Request, ctx?: Ctx) {
      const id = parseId((await paramsOf(ctx)).id);
      if (!id || !alerts.dismissAlert(id)) return jsonError("Alert not found", 404);
      return NextResponse.json({ ok: true, unread: alerts.unreadCount() });
    },
  };

  const settingsRoute = {
    async GET() {
      return NextResponse.json({ settings: settings.getSettings(), providers: engine.statuses(), fields: settings.fields });
    },
    async PUT(request: Request) {
      const body = await json<Record<string, unknown>>(request);
      if (!body || typeof body !== "object") return jsonError("Expected a JSON body");
      const check = settings.validate(body);
      if (!check.ok) return jsonError(`These have to be numbers, and none of your settings were changed: ${check.problems.join(", ")}.`);
      return NextResponse.json({ settings: settings.saveSettings(body as never), providers: engine.statuses() });
    },
  };

  const exportRoute = {
    async GET(request: Request) {
      const date = new Date().toISOString().slice(0, 10);
      const isSales = new URL(request.url).searchParams.get("type") === "sales";
      return new Response(isSales ? engine.exportSalesCsv() : engine.exportCsv(), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="collectcollect-${spec.id}-${isSales ? "sales-" : ""}${date}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    },
  };

  const importRoute = {
    async POST(request: Request) {
      const body = await json<{ csv?: unknown; apply?: unknown }>(request);
      if (!body) return jsonError("Expected a JSON body");
      if (typeof body.csv !== "string" || !body.csv.trim()) return jsonError("No CSV content");
      if (body.csv.length > MAX_CSV_BYTES) return jsonError("That file is larger than 8 MB", 413);
      try {
        const preview = csv.previewImport(body.csv);
        if (!body.apply) return NextResponse.json({ preview });
        return NextResponse.json({ preview, result: csv.applyImport(preview) });
      } catch (e) {
        return jsonError(`Could not read that file: ${errorMessage(e)}`, 400);
      }
    },
  };

  const collection = {
    async GET() {
      try {
        const files = mirror.collectionFiles();
        if (!files.some((file) => file.name.startsWith(`${mirror.folder}/`))) return jsonError("There is nothing in the collection yet", 404);
        const entries: ZipEntry[] = files.map((file) => ({ name: file.name, size: file.size, chunks: () => fileChunks(file.path) }));
        assertZippable(entries);
        const iterator = zipStream(entries);
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { value, done } = await iterator.next();
            if (done) controller.close();
            else controller.enqueue(value);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="collectcollect-${spec.id}-markdown-${new Date().toISOString().slice(0, 10)}.zip"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        return jsonError(`Could not package the collection: ${errorMessage(e)}`, 500);
      }
    },
  };

  const collectionRebuild = {
    async POST() {
      if (!mirror.mirrorEnabled()) return jsonError("The plain-text copy is switched off (MARKDOWN_MIRROR=off)", 409);
      try {
        return NextResponse.json({ result: mirror.rebuildCollection(repo.listItems()) });
      } catch (e) {
        return jsonError(`Could not write the files: ${errorMessage(e)}`, 500);
      }
    },
  };

  const collectionImport = {
    async POST(request: Request) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return jsonError("Expected multipart/form-data with an archive or Markdown files");
      }
      const archive = form.get("archive");
      const loose = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
      const total = (archive instanceof File ? archive.size : 0) + loose.reduce((n, f) => n + f.size, 0);
      if (total === 0) return jsonError("No files received");
      if (total > IMPORT_MAX_BYTES) return jsonError(`That is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB. Copy the folder into the data directory instead.`, 413);
      try {
        const files: Array<{ name: string; text: string }> = [];
        if (archive instanceof File && archive.size > 0) files.push(...(await restore.itemFilesFromZip(new Uint8Array(await archive.arrayBuffer()))));
        for (const file of loose) {
          if (!restore.isItemFileName(file.name)) continue;
          files.push({ name: file.name, text: await file.text() });
        }
        if (!files.length) return jsonError(`Nothing in that upload looked like a ${noun} file`);
        return NextResponse.json({ result: restore.importItemFiles(files) });
      } catch (e) {
        return jsonError(errorMessage(e), 400);
      }
    },
  };

  const locations = {
    async GET() {
      return NextResponse.json({ locations: repo.listLocations() });
    },
  };

  const pricesRefresh = {
    async POST(request: Request) {
      const stale = new URL(request.url).searchParams.get("stale");
      const staleHours = stale === null ? undefined : Number(stale);
      if (staleHours !== undefined && (!Number.isFinite(staleHours) || staleHours < 0)) return jsonError("stale has to be a number of hours");
      try {
        return NextResponse.json({ result: await refresh.refreshAll({ staleHours }) });
      } catch (e) {
        return jsonError(`Could not refresh prices: ${errorMessage(e)}`, 502);
      }
    },
  };

  const uploads = {
    async POST(request: Request) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return jsonError("Expected multipart/form-data");
      }
      const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
      if (files.length === 0) return jsonError("No files received");
      if (files.length > MAX_UPLOADS) return jsonError(`At most ${MAX_UPLOADS} files per request`);
      const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
      if (tooBig) return jsonError(`${tooBig.name || "A file"} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`, 413);
      try {
        const saved = [];
        for (const file of files) saved.push(await images.saveUpload(file));
        return NextResponse.json({ uploads: saved });
      } catch (e) {
        return jsonError(errorMessage(e), 400);
      }
    },
  };

  const upload = {
    async GET(_request: Request, ctx?: Ctx) {
      const { name } = await paramsOf(ctx);
      if (!name || !isValidUploadName(name)) return new Response("Not found", { status: 404 });
      const data = await images.readUpload(name);
      if (!data) return new Response("Not found", { status: 404 });
      return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
    },
  };

  const identify = {
    async POST(request: Request) {
      if (!engine.identifier || !spec.identify) return jsonError(`This app does not identify ${spec.noun.plural} from photos`, 404);
      const body = await json<{ uploads?: unknown; hint?: unknown }>(request);
      if (!body) return jsonError("Expected a JSON body");
      const names = Array.isArray(body.uploads) ? body.uploads.filter((n): n is string => typeof n === "string") : [];
      if (names.length === 0 || names.length > 4) return jsonError("Provide between 1 and 4 upload names");
      if (!names.every(isValidUploadName)) return jsonError("Invalid upload name");
      const photos = [];
      for (const name of names) {
        const buffer = await images.readUpload(name);
        if (!buffer) return jsonError(`Upload not found: ${name}`, 404);
        photos.push({ buffer });
      }
      try {
        const identification = await engine.identifier.identify(photos, typeof body.hint === "string" ? body.hint : undefined);
        const input = spec.identify.toInput(identification);
        return NextResponse.json({ identification, input });
      } catch (e) {
        if (e instanceof IdentifyError) return jsonError(e.message, e.status);
        console.error("identify failed", e);
        return jsonError(`Identification failed: ${errorMessage(e)}`, 500);
      }
    },
  };

  const backupRoute = {
    async GET() {
      try {
        const { filename, stream } = await backup.buildBackup();
        return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
      } catch (e) {
        return jsonError(`Backup failed: ${errorMessage(e)}`, 500);
      }
    },
  };

  const backupRestore = {
    async POST(request: Request) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return jsonError("Expected multipart/form-data with an archive");
      }
      const file = form.get("archive");
      if (!(file instanceof File) || file.size === 0) return jsonError("No archive received");
      if (file.size > RESTORE_MAX_BYTES) return jsonError(`That archive is larger than ${RESTORE_MAX_BYTES / 1024 / 1024} MB. Unpack it into the data directory by hand instead.`, 413);
      try {
        return NextResponse.json({ result: await backup.restoreBackup(new Uint8Array(await file.arrayBuffer())) });
      } catch (e) {
        return jsonError(errorMessage(e), 400);
      }
    },
  };

  const verifyCert = {
    async POST(_request: Request, ctx?: Ctx) {
      if (!spec.cert) return jsonError("This app has no certificate register to check", 404);
      const id = parseId((await paramsOf(ctx)).id);
      const found = id ? repo.getItem(id) : null;
      if (!found) return notFound();
      try {
        return NextResponse.json({ verification: await spec.cert.verify(found) });
      } catch (e) {
        return jsonError(`Could not check the certificate: ${errorMessage(e)}`, 502);
      }
    },
  };

  /** POST — load the sample collection, only into an empty one. */
  /** Load sample data; the spec's own by default, or whatever the app passes. */
  const seed = (run?: () => void) => ({
    async POST() {
      const load = run ?? (spec.seed?.length ? () => loadSeed(engine) : undefined);
      if (!load) return jsonError("This app has no sample data", 404);
      if (repo.countItems() > 0) return jsonError("Sample data only loads into an empty collection", 409);
      try {
        load();
        return NextResponse.json({ ok: true, items: repo.countItems() });
      } catch (e) {
        return jsonError(errorMessage(e), 500);
      }
    },
  });

  return {
    items,
    item,
    itemPrice,
    itemPrices,
    itemSales,
    itemAcquisitions,
    lot,
    intake,
    sales: salesRoute,
    sale,
    alerts: alertsRoute,
    alert,
    settings: settingsRoute,
    export: exportRoute,
    import: importRoute,
    collection,
    collectionRebuild,
    collectionImport,
    locations,
    pricesRefresh,
    uploads,
    upload,
    identify,
    backup: backupRoute,
    backupRestore,
    verifyCert,
    seed,
    auth: createAuthRoutes(engine.auth),
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
