import Link from "next/link";
import { submissionOutcome } from "@/lib/analytics";
import { money, when } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { listSubmissions } from "@/lib/submissions";
import { SUBMISSION_STATUSES, label } from "@/lib/types";
import { NewSubmission } from "@/components/NewSubmission";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100",
  sent: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  returned: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
};

export default function SubmissionsPage() {
  const submissions = listSubmissions();
  const settings = getSettings();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Grading submissions</h1>
          <p className="text-sm text-neutral-500">
            Group cards into a batch, send it off, then record what came back. Each batch reports what grading actually
            earned against what the cards were worth raw.
          </p>
        </div>
        <NewSubmission defaultFee={settings.gradingFee} />
      </div>

      {submissions.length === 0 ? (
        <div className="card-surface p-8 text-center text-sm text-neutral-500">
          No submissions yet. Start one, then add cards from the portfolio’s ready-to-grade list or from any card’s page.
        </div>
      ) : (
        <ul className="space-y-3">
          {submissions.map((s) => {
            const o = submissionOutcome(s);
            return (
              <li key={s.id} className="card-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/submissions/${s.id}`} className="font-display text-xl font-semibold hover:underline">
                      {s.name}
                    </Link>
                    <div className="text-sm text-neutral-500">
                      {s.company}
                      {s.serviceLevel ? ` · ${s.serviceLevel}` : ""} · {o.cards} card{o.cards === 1 ? "" : "s"} · cost {money(o.cost)}
                      {s.sentAt ? ` · sent ${when(s.sentAt)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {o.gain !== null ? (
                      <div className="text-right">
                        <div className="text-xs uppercase tracking-wide text-neutral-500">Net after fees</div>
                        <div className={`text-lg font-semibold ${o.gain >= 0 ? "delta-up" : "delta-down"}`}>
                          {o.gain >= 0 ? "+" : "−"}
                          {money(Math.abs(o.gain))}
                        </div>
                      </div>
                    ) : (
                      o.cards > 0 && (
                        <div className="text-right">
                          <div className="text-xs uppercase tracking-wide text-neutral-500">Raw → best case</div>
                          <div className="text-sm">
                            {money(o.rawValue)} → {money(o.expectedValue)}
                          </div>
                        </div>
                      )
                    )}
                    <span className={`badge ${STATUS_STYLE[s.status]}`}>{label(SUBMISSION_STATUSES, s.status)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
