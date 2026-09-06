"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { imageSrc, money, when } from "@/lib/format";
import { GAMES, type CardRecord, type PriceSnapshot, type PriceSummary, type Settings } from "@/lib/types";
import { gradingVerdict, outlookSeries } from "@/lib/analytics";
import { OutlookChart } from "./charts/OutlookChart";
import { CardForm, formFromCard, formToInput } from "./CardForm";
import { PricePanel } from "./PricePanel";

interface Props {
  card: CardRecord;
  latest: PriceSummary | null;
  history: PriceSnapshot[];
  settings: Settings;
}

export function CardDetail({ card: initial, latest: initialLatest, history: initialHistory, settings }: Props) {
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
  const [busy, setBusy] = useState<"" | "price" | "save" | "delete">("");
  const [error, setError] = useState<string | null>(null);

  const refreshPrice = async () => {
    setBusy("price");
    setError(null);
    try {
      const res = await api<{ card: CardRecord; snapshot: PriceSnapshot; stored: boolean }>(`/api/cards/${card.id}/price`, { method: "POST" });
      setCard(res.card);
      setLatest(res.snapshot.summary);
      if (res.stored) setHistory((h) => [res.snapshot, ...h]);
      else
        setError(
          res.snapshot.summary.errors.length
            ? "No source returned a price, so the previous snapshot was kept. See the errors below."
            : "No price source found a match for this card (or none is configured for its game; see Settings). The previous snapshot was kept.",
        );
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
  const outlook = graded ? [] : outlookSeries(history, settings);
  const verdict = gradingVerdict(outlook);
  const lastOutlook = outlook[outlook.length - 1];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr]">
      <div className="space-y-3">
        <div className="card-surface overflow-hidden">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={card.name} className="w-full bg-neutral-100 object-contain dark:bg-neutral-800" />
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center text-sm text-neutral-400">No image</div>
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
            </div>
            <h1 className="mt-1 text-2xl font-semibold">{card.name}</h1>
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
                <div>
                  <label className="label">Ungraded price</label>
                  <input className="input" value={manualUngraded} onChange={(e) => setManualUngraded(e.target.value)} inputMode="decimal" placeholder="leave blank to use market data" />
                </div>
                <div>
                  <label className="label">Graded prices</label>
                  <input className="input" value={manualGraded} onChange={(e) => setManualGraded(e.target.value)} placeholder="PSA 10=450, PSA 9=120" />
                </div>
              </div>
              <p className="mt-1 text-xs text-neutral-500">Manual entries take priority over provider data the next time prices are refreshed.</p>
            </div>
          </div>
        ) : (
          <dl className="card-surface grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm sm:grid-cols-3">
            <Field label="Quantity" value={String(card.quantity)} />
            <Field label="Your copy" value={graded ? `${card.gradingCompany ?? "Graded"} ${card.grade}${card.certNumber ? ` · #${card.certNumber}` : ""}` : `Raw · ${card.condition}`} />
            <Field label="Purchase price" value={card.purchasePrice ? money(card.purchasePrice) : "—"} />
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

        {latest && card.quantity > 1 && latest.yourCopyValue && (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {card.quantity} copies × {money(latest.yourCopyValue)} = <strong>{money(latest.yourCopyValue * card.quantity)}</strong>
          </p>
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
              <span className={`badge ${verdict.kind === "prime" ? "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100" : verdict.kind === "wait" ? "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100" : verdict.kind === "skip" ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100" : "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100"}`}>
                {verdict.headline}
              </span>
            </div>
            {lastOutlook && (
              <div className="my-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Field label="Raw (yours)" value={money(lastOutlook.raw)} />
                <Field label={`${lastOutlook.minLabel} (min)`} value={money(lastOutlook.min)} />
                <Field label={`${lastOutlook.maxLabel} (max)`} value={money(lastOutlook.max)} />
                <Field label="Upside after fee" value={money(lastOutlook.upside)} />
              </div>
            )}
            <OutlookChart series={outlook} />
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{verdict.detail}</p>
            {lastOutlook && !lastOutlook.fromRealData && (
              <p className="mt-1 text-xs text-neutral-500">Graded outcomes are estimates from your Settings multipliers; a PriceCharting token replaces them with real graded sales.</p>
            )}
          </section>
        )}

        {history.length > 1 && (
          <section className="card-surface p-4">
            <h3 className="mb-2 font-semibold">Price history</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-1 pr-3">When</th>
                    <th className="py-1 pr-3">Ungraded</th>
                    <th className="py-1 pr-3">Your copy</th>
                    <th className="py-1 pr-3">PSA 10</th>
                    <th className="py-1">Source</th>
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
