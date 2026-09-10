import { OutlookChart } from "@collectcollect/core/components/OutlookChart";
import { VERDICT_STYLE, gradingVerdict, isReadyToGrade } from "@collectcollect/core/grading";
import { money } from "@collectcollect/core/format";
import type { ItemPageContext, ItemPageExtras } from "@collectcollect/core/pages/ItemPage";
import { gradingSettingsOf, outlookFor, type ComicExtras } from "@/lib/pricing/summary";
import { COMPANIES, KEY_FLAGS, gradeNumber, type Comic, type ComicSettings } from "@/lib/types";

/**
 * What only this domain knows about a comic's page: the slab label, the key
 * issue line, the graded prices beside the price panel, and the
 * grade-or-wait outlook for a raw copy.
 */
export function comicExtras(ctx: ItemPageContext<Comic, ComicSettings, ComicExtras>): ItemPageExtras {
  const { item, snapshots, latest, settings } = ctx;

  const byGrade = (a: string, b: string) => (gradeNumber(b) ?? 0) - (gradeNumber(a) ?? 0);
  const named = latest
    ? [
        ...(latest.ungraded ? [{ label: "Raw", value: latest.ungraded }] : []),
        ...Object.keys(latest.graded)
          .sort(byGrade)
          .map((k) => ({ label: k, value: latest.graded[k] })),
        ...Object.keys(latest.estimatedGraded)
          .sort(byGrade)
          .slice(0, 3)
          .map((k) => ({ label: `${k} (estimate)`, value: latest.estimatedGraded[k], estimated: true })),
      ]
    : [];

  const header = (
    <div className="mt-2 space-y-1">
      {item.slabbed && (
        <p>
          <span className={`slab-label slab-${item.gradingCompany} inline-block rounded text-xs`}>
            {COMPANIES[item.gradingCompany]} {item.grade}
            {item.signatureSeries ? " · Signature Series" : ""}
          </span>
          {item.certNumber && (
            <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
              cert {item.certNumber}
            </span>
          )}
        </p>
      )}
      {item.keyFlags.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Key issue:</span> {item.keyFlags.map((f) => KEY_FLAGS[f]).join(", ")}
          {item.keyOf && ` of ${item.keyOf}`}
        </p>
      )}
    </div>
  );

  let afterPrice: React.ReactNode = null;
  if (!item.slabbed) {
    const series = outlookFor(item, snapshots, settings);
    const verdict = gradingVerdict(series);
    const ready = isReadyToGrade(series, verdict, gradingSettingsOf(settings));
    const last = series[series.length - 1];
    afterPrice = (
      <section className="card-surface space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Grade it, or wait?</h2>
          <span className={`badge ${VERDICT_STYLE[verdict.kind]}`}>{verdict.headline}</span>
        </div>
        <OutlookChart series={series} rawLabel={item.grade ? `Your raw ${item.grade}` : "Your raw copy"} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {verdict.detail}
          {last?.likely !== null && last?.likely !== undefined && ` At the ${last.likelyLabel} you expect, a slab would be worth ${money(last.likely)}.`}
          {last && !last.fromRealData && " The graded figure is an estimate from the multipliers in Settings; PriceCharting had no sale at that grade."}
        </p>
        {ready && (
          <p className="text-sm" style={{ color: "var(--chart-good-text)" }}>
            Clears your thresholds: {money(last.upside)} of upside after the {money(last.fee)} fee.
          </p>
        )}
      </section>
    );
  }

  return { header, afterPrice, named, handled: ["keyFlags", "keyOf"] };
}
