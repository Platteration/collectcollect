"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { imageSrc, money, when } from "@/lib/format";
import { GAMES, GRADING_STATUSES, type CardRecord, type GradingStatus, type PriceSnapshot, type PriceSummary, type Sale, type Settings } from "@/lib/types";
import { gradingVerdict, isReadyToGrade, outlookSeries } from "@/lib/analytics";
import { OutlookChart } from "./charts/OutlookChart";
import { PortfolioChart } from "./charts/PortfolioChart";
import { Slab } from "./Slab";
import { VERDICT_STYLE } from "./verdict";
import { CardForm, formFromCard, formToInput } from "./CardForm";
import type { Acquisition } from "@/lib/acquisitions";
import { PricePanel } from "./PricePanel";
import { AddToSubmission } from "./AddToSubmission";

interface Props {
  acquisitions: Acquisition[];
  card: CardRecord;
  latest: PriceSummary | null;
  history: PriceSnapshot[];
  settings: Settings;
  sales: Sale[];
}

export function CardDetail({ card: initial, latest: initialLatest, history: initialHistory, settings, sales: initialSales, acquisitions: initialAcquisitions }: Props) {
  const router = useRouter();
  const [card, setCard] = useState(initial);
  const [latest, setLatest] = useState(initialLatest);
  const [history, setHistory] = useState(initialHistory);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(formFromCard(initial));
  const [manualUngraded, setManualUngraded] = useState(initial.manualUngraded ? String(initial.manualUngraded) : "");
  const [manualGraded, setManualGraded] = useState(
    Object.entries(initial.manualGraded)
      .map(([k, v]) => `${k}=${v}`)
      .join(", "),
  );
  const [sales, setSales] = useState(initialSales);
  const [acquisitions, setAcquisitions] = useState(initialAcquisitions);
  const [buying, setBuying] = useState(false);
  const [buyForm, setBuyForm] = useState({ quantity: "1", unitCost: "", acquiredAt: new Date().toISOString().slice(0, 10), source: "" });
  const [selling, setSelling] = useState(false);
  const [saleForm, setSaleForm] = useState({ quantity: "1", unitPrice: "", fees: "", soldAt: new Date().toISOString().slice(0, 10), venue: "", notes: "" });
  const [busy, setBusy] = useState<"" | "price" | "save" | "delete" | "sell" | "buy">("");
  const [error, setError] = useState<string | null>(null);

  const refreshPrice = async () => {
    setBusy("price");
    setError(null);
    try {
      const res = await api<{ card: CardRecord; snapshot: PriceSnapshot; stored: boolean }>(`/api/cards/${card.id}/price`, { method: "POST" });
      setCard(res.card);
      if (res.stored) {
        setLatest(res.snapshot.summary);
        setHistory((h) => [res.snapshot, ...h]);
      } else {
        // Keep showing the last good prices; explain why nothing changed.
        const errs = res.snapshot.summary.errors.map((e) => `${e.source}: ${e.message}`).join("; ");
        setError(
          errs
            ? `No source returned a price, so the previous prices are still shown. ${errs}`
            : "No price source found a match for this card (or none is configured for its game; see Settings). The previous prices are still shown.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const graded: Record<string, number> = {};
      for (const part of manualGraded.split(",")) {
        const [k, v] = part.split("=").map((s) => s.trim());
        if (k && v && Number.isFinite(Number(v))) graded[k] = Number(v);
      }
      const res = await api<{ card: CardRecord }>(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...formToInput(form),
          manualUngraded: manualUngraded.trim() === "" ? null : Number(manualUngraded),
          manualGraded: graded,
        }),
      });
      setCard(res.card);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const setStatus = async (gradingStatus: GradingStatus) => {
    setError(null);
    try {
      const res = await api<{ card: CardRecord }>(`/api/cards/${card.id}`, { method: "PATCH", body: JSON.stringify({ gradingStatus }) });
      setCard(res.card);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const recordPurchase = async () => {
    const copies = Number(buyForm.quantity);
    if (!Number.isInteger(copies) || copies < 1) {
      setError("Enter at least one copy.");
      return;
    }
    const cost = buyForm.unitCost.trim() === "" ? null : Number(buyForm.unitCost);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      setError("Cost each must be a number.");
      return;
    }
    setBusy("buy");
    setError(null);
    try {
      const res = await api<{ card: CardRecord; acquisitions: Acquisition[] }>(`/api/cards/${card.id}/acquisitions`, {
        method: "POST",
        body: JSON.stringify({
          quantity: copies,
          unitCost: cost,
          acquiredAt: buyForm.acquiredAt ? new Date(`${buyForm.acquiredAt}T12:00:00`).toISOString() : undefined,
          source: buyForm.source,
        }),
      });
      setCard(res.card);
      setAcquisitions(res.acquisitions);
      setBuying(false);
      setBuyForm({ ...buyForm, quantity: "1", unitCost: "", source: "" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const removePurchase = async (lot: Acquisition) => {
    if (!confirm(`Remove the purchase of ${lot.quantity} cop${lot.quantity === 1 ? "y" : "ies"}? The copies go with it.`)) return;
    setError(null);
    try {
      const res = await api<{ card: CardRecord; acquisitions: Acquisition[] }>(`/api/cards/${card.id}/acquisitions/${lot.id}`, { method: "DELETE" });
      setCard(res.card);
      setAcquisitions(res.acquisitions);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reloadPurchases = async () => {
    try {
      const res = await api<{ acquisitions: Acquisition[] }>(`/api/cards/${card.id}/acquisitions`);
      setAcquisitions(res.acquisitions);
    } catch {
      /* the sale itself went through; the list catches up on the next load */
    }
  };

  const logSale = async () => {
    const price = Number(saleForm.unitPrice);
    if (!Number.isFinite(price) || price < 0) {
      setError("Sale price must be a number.");
      return;
    }
    const copies = Number(saleForm.quantity);
    if (!Number.isInteger(copies) || copies < 1) {
      setError("Sell at least one copy.");
      return;
    }
    const fees = saleForm.fees.trim() === "" ? 0 : Number(saleForm.fees);
    if (!Number.isFinite(fees) || fees < 0) {
      setError("Fees must be a number.");
      return;
    }
    setBusy("sell");
    setError(null);
    try {
      const res = await api<{ sale: Sale; card: CardRecord }>(`/api/cards/${card.id}/sales`, {
        method: "POST",
        body: JSON.stringify({
          quantity: copies,
          unitPrice: price,
          fees,
          // "2026-09-07" alone parses as UTC midnight, which reads as the day
          // before in the Americas; the time suffix makes it local.
          soldAt: saleForm.soldAt ? new Date(`${saleForm.soldAt}T12:00:00`).toISOString() : undefined,
          venue: saleForm.venue,
          notes: saleForm.notes,
        }),
      });
      setSales((prev) => [res.sale, ...prev]);
      setCard(res.card);
      await reloadPurchases();
      setSelling(false);
      setSaleForm((f) => ({ ...f, unitPrice: "", fees: "", venue: "", notes: "" }));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const undoSale = async (sale: Sale) => {
    if (!confirm(`Undo this sale? ${sale.quantity} cop${sale.quantity === 1 ? "y" : "ies"} will go back into your collection.`)) return;
    try {
      await api(`/api/sales/${sale.id}`, { method: "DELETE" });
      setSales((prev) => prev.filter((s) => s.id !== sale.id));
      const res = await api<{ card: CardRecord }>(`/api/cards/${card.id}`);
      setCard(res.card);
      await reloadPurchases();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${card.name} from your collection?`)) return;
    setBusy("delete");
    try {
      await api(`/api/cards/${card.id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  };

  const src = imageSrc(card);
  const graded = Boolean(card.grade);
  const valuePoints = [...history]
    .reverse()
    .filter((s) => s.summary.yourCopyValue)
    .map((s) => ({ t: s.fetchedAt, value: s.summary.yourCopyValue!, ungraded: s.summary.ungraded ?? 0, priced: 1 }));
  const firstPoint = valuePoints[0];
  const lastPoint = valuePoints.at(-1);
  const valueChange = valuePoints.length > 1 && firstPoint && lastPoint ? lastPoint.value - firstPoint.value : 0;
  const ret = card.purchasePrice !== null && latest?.yourCopyValue ? latest.yourCopyValue - card.purchasePrice : null;
  const assessment = card.identification?.condition_assessment ?? null;
  const expectedGrade = assessment?.estimated_grade_high ?? assessment?.estimated_grade_low ?? null;
  const outlook = graded ? [] : outlookSeries(history, settings, expectedGrade);
  const verdict = gradingVerdict(outlook);
  const lastOutlook = outlook[outlook.length - 1];
  const ready = isReadyToGrade(outlook, verdict, settings);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr]">
      <div className="space-y-3">
        <div
          className={`card-surface overflow-hidden p-2 ${card.accentColor ? "accent-wash" : ""}`}
          style={card.accentColor ? ({ "--accent": card.accentColor } as React.CSSProperties) : undefined}
        >
          {graded ? (
            <Slab company={card.gradingCompany} grade={card.grade!} certNumber={card.certNumber}>
              <CardArt src={src} name={card.name} />
            </Slab>
          ) : (
            <CardArt src={src} name={card.name} />
          )}
        </div>
        {card.imagePath && card.referenceImageUrl && (
          <a href={card.referenceImageUrl} target="_blank" rel="noreferrer" className="block text-xs text-neutral-500 underline">
            Reference image from price source
          </a>
        )}
        <button type="button" className="btn-danger w-full" onClick={remove} disabled={busy !== ""}>
          {busy === "delete" ? "Deleting…" : "Delete card"}
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="badge bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100">{GAMES[card.game]}</span>
              {card.sport && <span className="badge bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100">{card.sport}</span>}
              {card.quantity === 0 && <span className="badge bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">Sold</span>}
            </div>
            <h1 className="mt-1 font-display text-3xl font-semibold leading-tight">{card.name}</h1>
            <p className="text-sm text-neutral-500">
              {[card.setName, card.setCode, card.cardNumber ? `#${card.cardNumber}` : null, card.year, card.rarity, card.variant]
                .filter(Boolean)
                .join(" · ") || "No set details"}
            </p>
          </div>
          {!editing ? (
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditing(false);
                  setForm(formFromCard(card));
                }}
              >
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={save} disabled={busy !== ""}>
                {busy === "save" ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>

        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

        {editing ? (
          <div className="card-surface space-y-4 p-4">
            <CardForm value={form} onChange={setForm} />
            <div className="border-t border-black/10 pt-3 dark:border-white/10">
              <div className="mb-2 text-sm font-medium">Manual price overrides (USD)</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Ungraded price</span>
                  <input className="input" value={manualUngraded} onChange={(e) => setManualUngraded(e.target.value)} inputMode="decimal" placeholder="leave blank to use market data" />
                </label>
                <label className="block">
                  <span className="label">Graded prices</span>
                  <input className="input" value={manualGraded} onChange={(e) => setManualGraded(e.target.value)} placeholder="PSA 10=450, PSA 9=120" />
                </label>
              </div>
              <p className="mt-1 text-xs text-neutral-500">Manual entries take priority over provider data the next time prices are refreshed.</p>
            </div>
          </div>
        ) : (
          <dl className="card-surface grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm sm:grid-cols-3">
            <Field label="Quantity" value={String(card.quantity)} />
            <Field label="Your copy" value={graded ? `${card.gradingCompany ?? "Graded"} ${card.grade}${card.certNumber ? ` · #${card.certNumber}` : ""}` : `Raw · ${card.condition}`} />
            <Field label="Purchase price" value={card.purchasePrice ? money(card.purchasePrice) : "—"} />
            <Field label="Kept in" value={card.location ?? "—"} />
            <Field label="Language" value={card.language ?? "—"} />
            <Field label="Manufacturer" value={card.manufacturer ?? "—"} />
            <Field label="Added" value={when(card.createdAt)} />
            {card.notes && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs uppercase tracking-wide text-neutral-500">Notes</dt>
                <dd className="whitespace-pre-wrap">{card.notes}</dd>
              </div>
            )}
          </dl>
        )}

        <PricePanel summary={latest} loading={busy === "price"} onRefresh={refreshPrice} />

        {valuePoints.length > 1 && firstPoint && (
          <section className="card-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">Value of your copy</h3>
              <span className={`text-sm font-medium ${valueChange >= 0 ? "delta-up" : "delta-down"}`}>
                {valueChange >= 0 ? "▲" : "▼"} {money(Math.abs(valueChange))} since {when(firstPoint.t)}
              </span>
            </div>
            {ret !== null && (
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                Paid {money(card.purchasePrice)} · return{" "}
                <span className={`font-medium ${ret >= 0 ? "delta-up" : "delta-down"}`}>
                  {ret >= 0 ? "+" : "−"}
                  {money(Math.abs(ret))}
                  {card.purchasePrice ? ` (${((ret / card.purchasePrice) * 100).toFixed(1)}%)` : ""}
                </span>
                {card.quantity > 1 ? ` per copy` : ""}
              </p>
            )}
            <div className="mt-3">
              <PortfolioChart points={valuePoints} up={valueChange >= 0} height={200} label="Value of this card over time" detail={(p) => `ungraded ${money(p.ungraded)}`} />
            </div>
          </section>
        )}

        {latest && card.quantity > 1 && latest.yourCopyValue && (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {card.quantity} copies × {money(latest.yourCopyValue)} = <strong>{money(latest.yourCopyValue * card.quantity)}</strong>
          </p>
        )}

        {/* A card with no price yet has no outlook section to hold this, and
            can still be put into a batch. */}
        {!graded && !latest && card.gradingStatus !== "submitted" && (
          <div className="card-surface flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <span className="text-neutral-500">Sending this in for grading?</span>
            <AddToSubmission cardId={card.id} />
          </div>
        )}

        {!graded && latest && (
          <section className="card-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">Grading outlook</h3>
                <p className="text-sm text-neutral-500">
                  Range of outcomes if you graded this copy, versus what it is worth raw. Includes a {money(settings.gradingFee)} grading fee (Settings).
                </p>
              </div>
              <span className="flex flex-wrap items-center gap-1">
                {ready && card.gradingStatus !== "keep_raw" && card.gradingStatus !== "submitted" && (
                  <span className="badge bg-green-600 text-white">Ready</span>
                )}
                <span className={`badge ${VERDICT_STYLE[verdict.kind]}`}>{verdict.headline}</span>
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-neutral-500">Your plan:</span>
              {(Object.keys(GRADING_STATUSES) as GradingStatus[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={card.gradingStatus === k}
                  onClick={() => setStatus(k)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${card.gradingStatus === k ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "bg-black/5 text-neutral-700 hover:bg-black/10 dark:bg-white/10 dark:text-neutral-200"}`}
                >
                  {GRADING_STATUSES[k]}
                </button>
              ))}
            </div>
            {card.gradingStatus === "submitted" ? (
              <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
                When the card comes back, hit <strong>Edit</strong> and enter the grading company and grade; it will then be valued as a graded card.
              </p>
            ) : (
              <div className="mt-3">
                <AddToSubmission cardId={card.id} />
              </div>
            )}
            {lastOutlook && (
              <div className="my-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Field label="Raw (yours)" value={money(lastOutlook.raw)} />
                <Field label={`${lastOutlook.minLabel} (min)`} value={money(lastOutlook.min)} />
                <Field label={`${lastOutlook.maxLabel} (max)`} value={money(lastOutlook.max)} />
                <Field label="Upside after fee" value={money(lastOutlook.upside)} />
              </div>
            )}
            {lastOutlook?.likely !== null && lastOutlook?.likelyLabel && (
              <p className="mb-3 rounded-md well px-3 py-2 text-sm">
                The photo suggests this copy would grade around{" "}
                <strong>
                  {assessment?.estimated_grade_low && assessment.estimated_grade_low !== assessment.estimated_grade_high
                    ? `${assessment.estimated_grade_low}–${assessment.estimated_grade_high}`
                    : (expectedGrade ?? "")}
                </strong>
                , worth <strong>{money(lastOutlook.likely)}</strong> at {lastOutlook.likelyLabel} against {money(lastOutlook.raw)} raw
                {lastOutlook.likely - lastOutlook.raw - lastOutlook.fee > 0
                  ? `, so about ${money(lastOutlook.likely - lastOutlook.raw - lastOutlook.fee)} after the fee.`
                  : `, which does not cover the ${money(lastOutlook.fee)} fee.`}
              </p>
            )}
            <OutlookChart series={outlook} />
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{verdict.detail}</p>
            {lastOutlook && !lastOutlook.fromRealData && (
              <p className="mt-1 text-xs text-neutral-500">Graded outcomes are estimates from your Settings multipliers; a PriceCharting token replaces them with real graded sales.</p>
            )}
          </section>
        )}

        {assessment && (assessment.centering || assessment.corners || assessment.edges || assessment.surface || assessment.estimated_grade_high) && (
          <section className="card-surface p-4">
            <h3 className="font-semibold">Condition from the photo</h3>
            {assessment.estimated_grade_low && (
              <p className="mt-1 text-sm">
                Estimated grade{" "}
                <strong>
                  {assessment.estimated_grade_low}
                  {assessment.estimated_grade_high && assessment.estimated_grade_high !== assessment.estimated_grade_low ? `–${assessment.estimated_grade_high}` : ""}
                </strong>{" "}
                on the 10-point scale.
              </p>
            )}
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {([["Centering", assessment.centering], ["Corners", assessment.corners], ["Edges", assessment.edges], ["Surface", assessment.surface]] as const).map(
                ([label, value]) =>
                  value && (
                    <div key={label}>
                      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ),
              )}
            </dl>
            <p className="mt-3 text-xs text-neutral-500">
              {assessment.caveat ? `${assessment.caveat.replace(/[.;,]?\s*$/, "")}. ` : ""}A photo is not a grading service; treat this as a first
              look, not a prediction of what a grader would return.
            </p>
          </section>
        )}

        <section className="card-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">What you paid</h3>
            {!buying && (
              <button type="button" className="btn-secondary" onClick={() => setBuying(true)}>
                Add copies
              </button>
            )}
          </div>

          {buying && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="block">
                <span className="label">Copies</span>
                <input className="input" value={buyForm.quantity} onChange={(e) => setBuyForm({ ...buyForm, quantity: e.target.value })} inputMode="numeric" />
              </label>
              <label className="block">
                <span className="label">Cost each (USD)</span>
                <input
                  className="input"
                  value={buyForm.unitCost}
                  onChange={(e) => setBuyForm({ ...buyForm, unitCost: e.target.value })}
                  inputMode="decimal"
                  placeholder="leave blank if unknown"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="label">Bought</span>
                <input className="input" type="date" value={buyForm.acquiredAt} onChange={(e) => setBuyForm({ ...buyForm, acquiredAt: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">Where from</span>
                <input className="input" value={buyForm.source} onChange={(e) => setBuyForm({ ...buyForm, source: e.target.value })} placeholder="eBay, show, pack" />
              </label>
              <div className="col-span-2 flex gap-2 sm:col-span-4">
                <button type="button" className="btn-primary" onClick={recordPurchase} disabled={busy !== ""}>
                  {busy === "buy" ? "Saving…" : "Record purchase"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setBuying(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {acquisitions.length === 0 ? (
            !buying && <p className="mt-2 text-sm text-neutral-500">No purchases recorded.</p>
          ) : (
            <ul className="mt-3 divide-y divide-black/5 text-sm dark:divide-white/5">
              {acquisitions.map((lot) => (
                <li key={lot.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                  <div>
                    <div>
                      <strong>{lot.unitCost === null ? "Cost not recorded" : `${money(lot.unitCost)} each`}</strong>
                      {lot.source ? ` · ${lot.source}` : ""}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {lot.quantity} cop{lot.quantity === 1 ? "y" : "ies"}
                      {lot.remaining === lot.quantity ? "" : lot.remaining === 0 ? ", all gone" : `, ${lot.remaining} left`} · {when(lot.acquiredAt)}
                    </div>
                  </div>
                  {lot.remaining === lot.quantity && (
                    <button type="button" className="text-xs text-neutral-500 underline" onClick={() => removePurchase(lot)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {acquisitions.some((l) => l.unitCost === null && l.remaining > 0) && (
            <p className="mt-2 text-xs text-neutral-500">
              Copies with no recorded cost are left out of the return rather than counted as free.
            </p>
          )}
        </section>

        <section className="card-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Sales</h3>
            {card.quantity > 0 && !selling && (
              <button type="button" className="btn-secondary" onClick={() => setSelling(true)}>
                Log a sale
              </button>
            )}
          </div>

          {selling && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="label">Copies</span>
                <input className="input" value={saleForm.quantity} onChange={(e) => setSaleForm({ ...saleForm, quantity: e.target.value })} inputMode="numeric" />
              </label>
              <label className="block">
                <span className="label">Price each (USD)</span>
                <input className="input" value={saleForm.unitPrice} onChange={(e) => setSaleForm({ ...saleForm, unitPrice: e.target.value })} inputMode="decimal" autoFocus />
              </label>
              <label className="block">
                <span className="label">Fees total</span>
                <input className="input" value={saleForm.fees} onChange={(e) => setSaleForm({ ...saleForm, fees: e.target.value })} inputMode="decimal" placeholder="shipping + commission" />
              </label>
              <label className="block">
                <span className="label">Date</span>
                <input className="input" type="date" value={saleForm.soldAt} onChange={(e) => setSaleForm({ ...saleForm, soldAt: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">Where</span>
                <input className="input" value={saleForm.venue} onChange={(e) => setSaleForm({ ...saleForm, venue: e.target.value })} placeholder="eBay, show, trade" />
              </label>
              <label className="block">
                <span className="label">Notes</span>
                <input className="input" value={saleForm.notes} onChange={(e) => setSaleForm({ ...saleForm, notes: e.target.value })} />
              </label>
              <div className="col-span-2 flex gap-2 sm:col-span-3">
                <button type="button" className="btn-primary" onClick={logSale} disabled={busy !== "" || saleForm.unitPrice.trim() === ""}>
                  {busy === "sell" ? "Saving…" : "Record sale"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setSelling(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {sales.length === 0 ? (
            !selling && (
              <p className="mt-2 text-sm text-neutral-500">
                {card.quantity === 0 ? "Every copy is gone but no sale is recorded." : "No sales recorded. Logging one takes the copies out of your collection and books the gain."}
              </p>
            )
          ) : (
            <ul className="mt-3 divide-y divide-black/5 text-sm dark:divide-white/5">
              {sales.map((s) => {
                const net = s.unitPrice * s.quantity - s.fees;
                const gain = s.unitCost === null ? null : net - s.unitCost * s.quantity;
                return (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                    <div>
                      <div>
                        <strong>{money(net)}</strong> net for {s.quantity} cop{s.quantity === 1 ? "y" : "ies"}
                        {s.venue ? ` · ${s.venue}` : ""}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {money(s.unitPrice)} each{s.fees ? ` less ${money(s.fees)} fees` : ""} · {when(s.soldAt)}
                        {s.notes ? ` · ${s.notes}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {gain !== null && (
                        <span className={`font-medium ${gain >= 0 ? "delta-up" : "delta-down"}`}>
                          {gain >= 0 ? "+" : "−"}
                          {money(Math.abs(gain))}
                        </span>
                      )}
                      <button type="button" className="text-xs text-neutral-500 underline" onClick={() => undoSale(s)}>
                        Undo
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {history.length > 1 && (
          <section className="card-surface p-4">
            <h3 className="mb-2 font-semibold">Price history</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th scope="col" className="py-1 pr-3">When</th>
                    <th scope="col" className="py-1 pr-3">Ungraded</th>
                    <th scope="col" className="py-1 pr-3">Your copy</th>
                    <th scope="col" className="py-1 pr-3">PSA 10</th>
                    <th scope="col" className="py-1">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((s) => (
                    <tr key={s.id} className="border-t border-black/5 dark:border-white/5">
                      <td className="py-1 pr-3 whitespace-nowrap">{when(s.fetchedAt)}</td>
                      <td className="py-1 pr-3">{money(s.summary.ungraded)}</td>
                      <td className="py-1 pr-3">{money(s.summary.yourCopyValue)}</td>
                      <td className="py-1 pr-3">
                        {s.summary.graded["PSA 10"] ? money(s.summary.graded["PSA 10"]) : s.summary.estimatedGraded["PSA 10"] ? `${money(s.summary.estimatedGraded["PSA 10"])} est.` : "—"}
                      </td>
                      <td className="py-1 text-neutral-500">{s.summary.ungradedSource ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
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

function CardArt({ src, name }: { src: string | null; name: string }) {
  if (!src) {
    return <div className="flex aspect-[3/4] items-center justify-center text-sm text-neutral-400">No image</div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={name} className="w-full rounded-[0.35rem] object-contain" />;
}
