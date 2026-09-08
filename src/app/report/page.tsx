import Link from "next/link";
import { latestSnapshotsByCard, listCards } from "@/lib/cards";
import { imageSrc, money, when } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { GAMES } from "@/lib/types";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/**
 * A printable valuation of the collection, for insurance or personal records.
 * Print to PDF from the browser; the print stylesheet drops the app chrome.
 */
export default function ReportPage() {
  const settings = getSettings();
  const cards = listCards().filter((c) => c.quantity > 0);
  const prices = latestSnapshotsByCard();
  const rows = cards
    .map((c) => {
      const s = prices.get(c.id)?.summary;
      const each = s?.yourCopyValue ?? null;
      return {
        card: c,
        each,
        total: each === null ? null : each * c.quantity,
        source: s?.ungradedSource ?? null,
        asOf: s?.fetchedAt ?? null,
      };
    })
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));

  const total = rows.reduce((n, r) => n + (r.total ?? 0), 0);
  const copies = cards.reduce((n, c) => n + c.quantity, 0);
  const unpriced = rows.filter((r) => r.total === null).length;
  const generated = new Date().toISOString();

  return (
    <div className="report space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <p className="max-w-2xl text-sm text-neutral-500">
          A valuation of every card you own, at the grade or condition you recorded. Print this page or save it as a PDF
          from your browser’s print dialog.
        </p>
        <div className="flex gap-2">
          <Link href="/settings" className="btn-secondary">
            Set owner name
          </Link>
          <PrintButton />
        </div>
      </div>

      <header className="border-b border-black/10 pb-4 dark:border-white/10">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Collection valuation</h1>
        {settings.ownerName && <p className="mt-1 text-lg">{settings.ownerName}</p>}
        <p className="mt-1 text-sm text-neutral-500">Prepared {when(generated)}</p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Summary label="Cards" value={String(cards.length)} />
        <Summary label="Copies" value={String(copies)} />
        <Summary label="Total value" value={money(total)} />
        <Summary label="Unpriced" value={String(unpriced)} />
      </section>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/15 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-white/15">
            <th className="py-2 pr-2">Card</th>
            <th className="py-2 pr-2">Details</th>
            <th className="py-2 pr-2">Condition</th>
            <th className="py-2 pr-2">Kept in</th>
            <th className="py-2 pr-2 text-right">Qty</th>
            <th className="py-2 pr-2 text-right">Each</th>
            <th className="py-2 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ card, each, total: rowTotal, source, asOf }) => {
            const src = imageSrc(card);
            return (
              <tr key={card.id} className="break-inside-avoid border-b border-black/5 align-top dark:border-white/5">
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-2">
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <span className="font-medium">{card.name}</span>
                  </div>
                </td>
                <td className="py-2 pr-2 text-neutral-600 dark:text-neutral-300">
                  <div>{GAMES[card.game]}</div>
                  <div className="text-xs text-neutral-500">
                    {[card.setName, card.cardNumber ? `#${card.cardNumber}` : null, card.year, card.variant].filter(Boolean).join(" · ") || "—"}
                  </div>
                </td>
                <td className="py-2 pr-2">
                  {card.grade ? `${card.gradingCompany ?? "Graded"} ${card.grade}` : `Raw · ${card.condition}`}
                  {card.certNumber && <div className="text-xs text-neutral-500">Cert {card.certNumber}</div>}
                </td>
                <td className="py-2 pr-2 text-neutral-600 dark:text-neutral-300">{card.location ?? "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{card.quantity}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{money(each)}</td>
                <td className="py-2 text-right tabular-nums font-medium">
                  {money(rowTotal)}
                  {source && <div className="text-[10px] font-normal text-neutral-500">{source}{asOf ? `, ${new Date(asOf).toLocaleDateString("en-US")}` : ""}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black/20 dark:border-white/20">
            <td colSpan={6} className="py-3 pr-2 text-right font-medium">
              Total
            </td>
            <td className="py-3 text-right text-lg font-semibold tabular-nums">{money(total)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-xs leading-relaxed text-neutral-500">
        Values are market estimates gathered from the third-party price sources named in each row, at the date shown,
        for a copy in the stated grade or condition. Estimated graded values derived from multipliers rather than
        reported sales are marked as estimates in the app. Trading card prices move daily; this document is a snapshot,
        not a professional appraisal.
      </p>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="hero-figure text-2xl">{value}</div>
    </div>
  );
}
