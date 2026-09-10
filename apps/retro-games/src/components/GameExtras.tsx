import { OutlookChart } from "@collectcollect/core/components/OutlookChart";
import { VERDICT_STYLE, gradingVerdict, isReadyToGrade } from "@collectcollect/core/grading";
import { money } from "@collectcollect/core/format";
import type { ItemPageContext, ItemPageExtras } from "@collectcollect/core/pages/ItemPage";
import { gradeable, gradingSettingsOf, outlookFor, rawTier, type GameExtras } from "@/lib/pricing/summary";
import { COMPANIES, type Game, type GameSettings } from "@/lib/types";

/**
 * What only this domain knows about a game's page: the slab label on a
 * graded copy, the completeness prices beside the price panel, and the
 * grade-or-wait outlook for a sealed or complete copy.
 */
export function gameExtras(ctx: ItemPageContext<Game, GameSettings, GameExtras>): ItemPageExtras {
  const { item, snapshots, latest, settings } = ctx;

  const named = latest
    ? [
        ...["Loose", "CIB", "New", "Graded"].filter((k) => latest.tiers[k]).map((k) => ({ label: k === "New" ? "New (sealed)" : k, value: latest.tiers[k] })),
        ...(latest.estimatedGraded.Graded ? [{ label: "Graded (estimate)", value: latest.estimatedGraded.Graded, estimated: true }] : []),
      ]
    : [];

  const header =
    item.completeness === "graded" ? (
      <p className="mt-2">
        <span className={`slab-label slab-${item.gradingCompany} inline-block rounded text-xs`}>
          {COMPANIES[item.gradingCompany]} {item.grade}
        </span>
        {item.certNumber && (
          <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
            cert {item.certNumber}
          </span>
        )}
      </p>
    ) : null;

  let afterPrice: React.ReactNode = null;
  if (gradeable(item)) {
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
        <OutlookChart series={series} rawLabel={`Your ${rawTier(item)} copy`} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {verdict.detail}
          {last && !last.fromRealData && " The graded figure is an estimate from the multiplier in Settings; PriceCharting had no graded sale."}
        </p>
        {ready && (
          <p className="text-sm" style={{ color: "var(--chart-good-text)" }}>
            Clears your thresholds: {money(last.upside)} of upside after the {money(last.fee)} fee.
          </p>
        )}
      </section>
    );
  }

  return { header, afterPrice, named };
}
