"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { when } from "@/lib/format";
import { AGENCIES, agencyOf } from "@/lib/grading/agencies";
import { type CardRecord, type GradingReport as Report, type GradingReportInput } from "@/lib/types";
import { slabClass } from "./Slab";
import { CenteringSummary } from "./CenteringSummary";

/**
 * What the grading company's public report says about this slab, a link to
 * that report, and the two ways to fill it: PSA's lookup when the server has
 * a token, and a form for what the owner reads off any company's report.
 */
export function GradingReport({ card, psaConfigured, onUpdated }: { card: CardRecord; psaConfigured: boolean; onUpdated: (card: CardRecord) => Promise<void> | void }) {
  const agency = agencyOf(card.gradingCompany);
  const report = card.gradingReport;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [fillIdentity, setFillIdentity] = useState(false);
  const url = agency?.reportUrl(card.certNumber) ?? null;
  const company = agency?.id ?? card.gradingCompany ?? "Graded";

  const lookUp = async () => {
    if (report && report.source === "manual" && !confirm("Replace the report entered by hand with PSA's record?")) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await api<{ card: CardRecord; imagesSkipped: boolean }>(`/api/cards/${card.id}/cert`, { method: "POST", body: JSON.stringify({ apply: { identity: fillIdentity } }) });
      await onUpdated(res.card);
      setStatus(`Filled from PSA's records ${when(new Date().toISOString())}.${res.imagesSkipped ? " PSA's scans could not be fetched; try again later." : ""}`);
    } catch (e) {
      const wait = e instanceof ApiError && e.retryAfter ? ` (wait ${e.retryAfter}s)` : "";
      setError(`${(e as Error).message}${wait}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ card: CardRecord }>(`/api/cards/${card.id}`, { method: "PATCH", body: JSON.stringify({ gradingReport: null }) });
      await onUpdated(res.card);
      setStatus("Report removed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-surface p-4" data-testid="grading-report">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          <span className={`slab-label mr-2 inline-block ${slabClass(card.gradingCompany)}`}>{company}</span>
          {company} grading report
        </h3>
        {agency && (
          <div className="flex flex-wrap items-center gap-2">
            {agency.lookup && psaConfigured && (
              <button type="button" className="btn-secondary" onClick={lookUp} disabled={busy || !AGENCIES.PSA.certPattern.test(card.certNumber ?? "")} title={AGENCIES.PSA.certPattern.test(card.certNumber ?? "") ? undefined : `A PSA cert number is ${AGENCIES.PSA.certHint}.`}>
                {busy ? "Looking up…" : "Look up on PSA"}
              </button>
            )}
            {!editing && (
              <button type="button" className="btn-secondary" onClick={() => setEditing(true)} disabled={busy}>
                {report ? "Edit the report" : "Enter the report by hand"}
              </button>
            )}
          </div>
        )}
      </div>

      <p className="mt-2 text-sm">
        {card.certNumber ? (
          <>
            Cert {card.certNumber}
            {url && (
              <>
                {" · "}
                <a href={url} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                  {agency!.linkText}
                </a>
                {agency!.formOnly && <span className="text-neutral-500"> (enter the cert on their page)</span>}
              </>
            )}
            {!agency && <span className="text-neutral-500"> · {card.gradingCompany} has no public report this app can link to.</span>}
          </>
        ) : (
          "No cert number recorded. Add it with Edit."
        )}
      </p>

      {agency?.lookup && psaConfigured && (
        <label className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
          <input type="checkbox" checked={fillIdentity} onChange={(e) => setFillIdentity(e.target.checked)} />
          Also fill the card&apos;s blank set, number and year from PSA&apos;s record
        </label>
      )}
      {agency?.lookup && !psaConfigured && (
        <p className="mt-2 text-xs text-neutral-500">Set PSA_API_TOKEN on the server to fill this from PSA&apos;s records (Settings → Data sources).</p>
      )}

      {report ? <ReportBody report={report} /> : agency && !editing && (
        <p className="mt-3 text-sm text-neutral-500">
          No report recorded. {agency.lookup && psaConfigured ? "Look it up on PSA, or open" : "Open"} the report on {agency.label} and enter what it says.
        </p>
      )}

      {report && !editing && (
        <button type="button" className="mt-2 text-xs underline decoration-dotted" onClick={remove} disabled={busy}>
          Remove report
        </button>
      )}

      {editing && agency && (
        <ReportForm
          card={card}
          agency={agency}
          onCancel={() => setEditing(false)}
          onSaved={async (c) => {
            setEditing(false);
            setStatus("Report saved.");
            await onUpdated(c);
          }}
        />
      )}

      <h4 className="mt-4 text-sm font-medium">Centering</h4>
      <div className="mt-1">
        <CenteringSummary centering={card.centering} game={card.game} empty="No centering measured. Enter it from the report below, with Edit, or by identifying the card from a photo." />
      </div>

      {status && <p role="status" className="mt-3 text-xs text-green-800 dark:text-green-300">{status}</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}

const SUBGRADE_LABELS = [
  ["centering", "Centering"],
  ["corners", "Corners"],
  ["edges", "Edges"],
  ["surface", "Surface"],
] as const;

function ReportBody({ report }: { report: Report }) {
  const s = report.subgrades;
  const hasBack = s ? SUBGRADE_LABELS.some(([k]) => s[k].back !== null) : false;
  const t = report.tag;
  const p = report.population;
  const i = report.identity;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-neutral-600 dark:text-neutral-300">
        {[report.label ? `${report.label} label` : null, report.grade ? `grade ${report.gradeText ?? report.grade}` : null, `checked ${when(report.checkedAt)}`, report.source === "psa" ? "from PSA's records" : "entered by hand from the report"]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {s && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {SUBGRADE_LABELS.flatMap(([key, label]) => {
            const out = [];
            if (s[key].front !== null) out.push(<Field key={`${key}-front`} label={hasBack ? `Front ${label.toLowerCase()}` : label} value={String(s[key].front)} />);
            if (s[key].back !== null) out.push(<Field key={`${key}-back`} label={`Back ${label.toLowerCase()}`} value={String(s[key].back)} />);
            return out;
          })}
        </dl>
      )}
      {t && (
        <div className="space-y-1">
          {t.score !== null && (
            <p>
              <strong>TAG score {t.score}</strong> of 1000
              {Object.values(t.rollups).some((v) => v !== null) && (
                <span className="text-neutral-500"> · {SUBGRADE_LABELS.filter(([k]) => t.rollups[k] !== null).map(([k, label]) => `${label.toLowerCase()} ${t.rollups[k]}`).join(", ")}</span>
              )}
            </p>
          )}
          {(t.composite.front !== null || t.composite.back !== null) && <p className="text-neutral-500">Front {t.composite.front ?? "—"} · back {t.composite.back ?? "—"} of 1000.</p>}
          {Object.values(t.dings).some((v) => v !== null) && (
            <p className="text-neutral-500">
              Defects noted:{" "}
              {(["cornersFront", "cornersBack", "edgesFront", "edgesBack", "surfaceFront", "surfaceBack"] as const)
                .filter((k) => t.dings[k] !== null)
                .map((k) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${t.dings[k]}`)
                .join(", ")}
            </p>
          )}
        </div>
      )}
      {p && (
        <p className="text-neutral-500">
          Population {[p.atGrade !== null ? `${p.atGrade} at this grade` : null, p.total !== null ? `${p.total} in all` : null, p.higher !== null ? `${p.higher} higher` : null].filter(Boolean).join(", ")}.
        </p>
      )}
      {i && (
        <p className="text-neutral-500">
          {report.company} lists it as: {[i.year, i.brand, i.variety, i.subject, i.cardNumber ? `#${i.cardNumber}` : null].filter(Boolean).join(" ")}
          {i.category ? ` (${i.category})` : ""}
        </p>
      )}
      {report.images && (report.images.front || report.images.back) && (
        <div>
          <div className="flex flex-wrap gap-2">
            {report.images.front && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={report.images.front} alt={`${report.company} front scan`} loading="lazy" referrerPolicy="no-referrer" className="max-h-64 rounded-md" />
            )}
            {report.images.back && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={report.images.back} alt={`${report.company} back scan`} loading="lazy" referrerPolicy="no-referrer" className="max-h-64 rounded-md" />
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">Scans from {report.company}, shown from its site.</p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type Agency = NonNullable<ReturnType<typeof agencyOf>>;

const text = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** What the owner types off the report; numbers as text until the server reads them. */
function ReportForm({ card, agency, onCancel, onSaved }: { card: CardRecord; agency: Agency; onCancel: () => void; onSaved: (card: CardRecord) => Promise<void> }) {
  const r = card.gradingReport;
  const [cert, setCert] = useState(card.certNumber ?? "");
  const [grade, setGrade] = useState(r?.grade ?? card.grade ?? "");
  const [label, setLabel] = useState(r?.label ?? "");
  const [sub, setSub] = useState<Record<string, string>>(() =>
    Object.fromEntries(SUBGRADE_LABELS.flatMap(([k]) => [[`${k}Front`, text(r?.subgrades?.[k].front)], [`${k}Back`, text(r?.subgrades?.[k].back)]])),
  );
  const [tag, setTag] = useState<Record<string, string>>({
    score: text(r?.tag?.score),
    centering: text(r?.tag?.rollups.centering),
    corners: text(r?.tag?.rollups.corners),
    edges: text(r?.tag?.rollups.edges),
    surface: text(r?.tag?.rollups.surface),
    front: text(r?.tag?.composite.front),
    back: text(r?.tag?.composite.back),
  });
  const [pop, setPop] = useState({ atGrade: text(r?.population?.atGrade), total: text(r?.population?.total), higher: text(r?.population?.higher) });
  const [centeringFront, setCenteringFront] = useState("");
  const [centeringBack, setCenteringBack] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const n = (v: string) => (v.trim() === "" ? null : v.trim());
    const report: GradingReportInput = {
      company: agency.id,
      cert: cert.trim(),
      source: "manual",
      checkedAt: new Date().toISOString(),
      label: n(label),
      grade: n(grade),
      subgrades:
        agency.subgrades === "none"
          ? null
          : Object.fromEntries(SUBGRADE_LABELS.map(([k]) => [k, { front: n(sub[`${k}Front`] ?? ""), back: agency.subgrades === "eight" ? n(sub[`${k}Back`] ?? "") : null }])),
      tag: agency.tag ? { score: n(tag.score ?? ""), rollups: { centering: n(tag.centering ?? ""), corners: n(tag.corners ?? ""), edges: n(tag.edges ?? ""), surface: n(tag.surface ?? "") }, composite: { front: n(tag.front ?? ""), back: n(tag.back ?? "") } } : null,
      population: { atGrade: n(pop.atGrade), total: n(pop.total), higher: n(pop.higher) },
      images: r?.images ?? null,
      url: agency.reportUrl(cert.trim()),
      identity: r?.identity ?? null,
    };
    try {
      const body: Record<string, unknown> = { gradingCompany: agency.id, certNumber: cert.trim() || null, grade: n(grade) ?? card.grade, gradingReport: report };
      // Blank centering boxes leave the card's centering as it is.
      if (centeringFront.trim() || centeringBack.trim()) body.centering = { front: centeringFront, back: centeringBack };
      const res = await api<{ card: CardRecord }>(`/api/cards/${card.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await onSaved(res.card);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = (value: string, set: (v: string) => void, placeholder: string, extra: Record<string, string> = {}) => (
    <input className="input" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} inputMode="decimal" {...extra} />
  );

  return (
    <div className="mt-3 space-y-3 border-t border-black/10 pt-3 text-sm dark:border-white/10">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label">Cert number</span>
          <input className="input" value={cert} onChange={(e) => setCert(e.target.value)} placeholder={agency.certHint} />
        </label>
        <label className="block">
          <span className="label">Grade</span>
          {input(grade, setGrade, "10")}
        </label>
        {agency.labels.length > 0 && (
          <label className="block">
            <span className="label">Label</span>
            <select className="input" value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="">Standard</option>
              {agency.labels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {agency.subgrades !== "none" && (
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">Subgrades</div>
          <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SUBGRADE_LABELS.map(([k, name]) => (
              <label key={k} className="block">
                <span className="label">{agency.subgrades === "eight" ? `Front ${name.toLowerCase()}` : name}</span>
                {input(sub[`${k}Front`] ?? "", (v) => setSub((s) => ({ ...s, [`${k}Front`]: v })), "9.5", { "aria-label": `${agency.subgrades === "eight" ? "Front " : ""}${name.toLowerCase()} subgrade` })}
              </label>
            ))}
            {agency.subgrades === "eight" &&
              SUBGRADE_LABELS.map(([k, name]) => (
                <label key={`${k}-back`} className="block">
                  <span className="label">Back {name.toLowerCase()}</span>
                  {input(sub[`${k}Back`] ?? "", (v) => setSub((s) => ({ ...s, [`${k}Back`]: v })), "9.5", { "aria-label": `Back ${name.toLowerCase()} subgrade` })}
                </label>
              ))}
          </div>
        </div>
      )}
      {agency.tag && (
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">TAG score, out of 1000</div>
          <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["score", "TAG score"],
                ["centering", "Centering"],
                ["corners", "Corners"],
                ["edges", "Edges"],
                ["surface", "Surface"],
                ["front", "Front composite"],
                ["back", "Back composite"],
              ] as const
            ).map(([k, name]) => (
              <label key={k} className="block">
                <span className="label">{name}</span>
                {input(tag[k] ?? "", (v) => setTag((s) => ({ ...s, [k]: v })), "960", { "aria-label": name })}
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500">Population</div>
        <div className="mt-1 grid grid-cols-3 gap-3">
          <label className="block">
            <span className="label">At this grade</span>
            {input(pop.atGrade, (v) => setPop((s) => ({ ...s, atGrade: v })), "12")}
          </label>
          <label className="block">
            <span className="label">In all</span>
            {input(pop.total, (v) => setPop((s) => ({ ...s, total: v })), "40")}
          </label>
          <label className="block">
            <span className="label">Higher</span>
            {input(pop.higher, (v) => setPop((s) => ({ ...s, higher: v })), "3")}
          </label>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500">Centering as printed on the report</div>
        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Front</span>
            <input className="input" value={centeringFront} onChange={(e) => setCenteringFront(e.target.value)} placeholder="54L/46R 49T/51B" />
          </label>
          <label className="block">
            <span className="label">Back</span>
            <input className="input" value={centeringBack} onChange={(e) => setCenteringBack(e.target.value)} placeholder="45L/55R 49T/51B" />
          </label>
        </div>
        <p className="mt-1 text-xs text-neutral-500">Leave blank to keep the centering the card already has.</p>
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save report"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
