import Link from "next/link";
import type { Engine } from "../domain/engine";
import { optionLabel } from "../domain/spec";
import { money } from "../format";
import { ItemTile } from "../components/domain/ItemTile";
import { RefreshPrices } from "../components/domain/RefreshPrices";
import { Figure, imageOf, one, plural } from "./shared";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Everything held, searchable and narrowed by whatever the spec marks as
 * filterable, plus where it is kept. Filters are query parameters, so a view
 * can be bookmarked and the back button works.
 */
export function CollectionPage<F extends object, S extends object, X extends object, Q>({ engine, searchParams, extra }: { engine: Engine<F, S, X, Q>; searchParams: SearchParams; extra?: (item: Parameters<typeof engine.spec.title>[0]) => string | null }) {
  const { spec, repo } = engine;
  const q = one(searchParams, "q") ?? "";
  const location = one(searchParams, "location");
  const showSold = one(searchParams, "sold") === "1";
  const filterable = spec.fields.filter((f) => f.filterable && (f.type === "enum" || f.type === "boolean"));
  const filters: Record<string, string> = {};
  for (const f of filterable) {
    const v = one(searchParams, `f_${f.key}`);
    if (v) filters[f.key] = v;
  }

  const items = repo.listItems({
    search: q,
    location: location === undefined || location === "" ? undefined : location === "none" ? "" : location,
    filters,
    includeSold: showSold,
  });
  const latest = repo.latestSnapshotsByItem();
  const locations = repo.listLocations();

  const valueOf = (item: (typeof items)[number]) => engine.valuation(item, latest.get(item.id)).value;
  let copies = 0;
  let total = 0;
  let unpriced = 0;
  let held = 0;
  for (const item of items) {
    if (item.quantity === 0) continue;
    held++;
    copies += item.quantity;
    const v = valueOf(item);
    if (v === null) unpriced++;
    else if (engine.counts(item)) total += v * item.quantity;
  }

  const active = Object.keys(filters).length > 0 || Boolean(location) || showSold;
  const staleCount = items.filter((i) => i.quantity > 0 && engine.counts(i)).length;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label={spec.noun.plural} value={String(held)} note={`${plural(copies, "copy", "copies")}${items.length - held ? ` · ${items.length - held} sold` : ""}`} />
        <Figure label="Worth" value={money(total)} note={unpriced ? `${unpriced} not priced` : held ? "everything is priced" : "nothing to price"} />
        <Figure label="Kept in" value={String(locations.length)} note={locations.length === 1 ? "location" : "locations"} />
        <div className="card-surface flex flex-col justify-between p-3">
          <p className="label mb-0.5">Prices</p>
          <RefreshPrices count={staleCount} />
        </div>
      </section>

      <form className="flex flex-wrap items-center gap-2" action="/collection">
        <input name="q" defaultValue={q} placeholder={`Search ${spec.noun.plural}…`} className="input max-w-xs" aria-label={`Search ${spec.noun.plural}`} />
        {filterable.map((f) => (
          <select key={f.key} name={`f_${f.key}`} defaultValue={filters[f.key] ?? ""} className="input max-w-[12rem]" aria-label={f.label}>
            <option value="">{f.type === "boolean" ? `${f.label}: any` : `All ${f.label.toLowerCase()}s`}</option>
            {f.type === "boolean" ? (
              <>
                <option value="1">{f.label}: yes</option>
                <option value="0">{f.label}: no</option>
              </>
            ) : (
              Object.entries(f.options ?? {}).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))
            )}
          </select>
        ))}
        {locations.length > 0 && (
          <select name="location" defaultValue={location ?? ""} className="input max-w-[12rem]" aria-label="Location">
            <option value="">Anywhere</option>
            <option value="none">No location</option>
            {locations.map((l) => (
              <option key={l.location} value={l.location}>
                {l.location} ({l.items})
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="sold" value="1" defaultChecked={showSold} />
          Include sold
        </label>
        <button type="submit" className="btn-secondary">
          Apply
        </button>
        {(q || active) && (
          <Link href="/collection" className="text-sm underline decoration-dotted" style={{ color: "var(--muted)" }}>
            Clear
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <p className="card-surface p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          {q || active ? (
            <>
              Nothing matches.{" "}
              <Link href="/collection" className="underline">
                Clear the filters
              </Link>{" "}
              to see everything.
            </>
          ) : (
            <>
              Nothing here yet.{" "}
              <Link href="/add" className="underline">
                Add a {spec.noun.singular}
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id} className="contents">
              <ItemTile
                id={item.id}
                title={spec.title(item)}
                detail={spec.detail(item)}
                condition={spec.conditionLabel(item)}
                extra={extra ? extra(item) : summaryLine(spec.fields, item as Record<string, unknown>)}
                image={imageOf(item)}
                value={valueOf(item)}
                quantity={item.quantity}
                unique={spec.isUnique(item)}
                sold={item.quantity === 0}
                excluded={item.quantity > 0 && !engine.counts(item)}
                accent={item.accentColor}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The fields the spec marks as worth a line on a tile, joined. */
function summaryLine(fields: Engine["spec"]["fields"], item: Record<string, unknown>): string | null {
  const parts = fields.filter((f) => f.summary).map((f) => optionLabel(f, item[f.key])).filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
