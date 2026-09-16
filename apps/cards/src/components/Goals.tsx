"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { money } from "@/lib/format";
import { GAMES } from "@/lib/types";
import type { Goal, GoalItem } from "@/lib/goals/domain";

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const save = async (url: string, method: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { await api(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); router.refresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, save };
}
const numeric = (form: FormData, key: string) => form.get(key) === "" ? null : Number(form.get(key));
function GoalForm({ goal }: { goal?: Goal }) {
  const { busy, error, save } = useSave();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget, data = new FormData(form);
    if (await save(goal ? `/api/goals/${goal.id}` : "/api/goals", goal ? "PUT" : "POST", {
      name: data.get("name"), budget: numeric(data, "budget"), targetDate: data.get("targetDate"), archived: goal?.archived ?? false,
    })) { if (!goal) form.reset(); }
  };
  return <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
    <label className="label">Goal name<input className="input" name="name" required maxLength={120} defaultValue={goal?.name} placeholder="My childhood favorites" /></label>
    <label className="label">Budget for remaining cards (USD)<input className="input" name="budget" type="number" min="0" step="0.01" defaultValue={goal?.budget ?? ""} placeholder="Optional" /></label>
    <label className="label">Target date<input className="input" name="targetDate" type="date" defaultValue={goal?.targetDate ?? ""} /></label>
    <div className="sm:col-span-3"><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : goal ? "Save goal" : "Create goal"}</button></div>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 sm:col-span-3">{error}</p>}
  </form>;
}
function WantedForm({ goalId, item }: { goalId: string; item?: GoalItem }) {
  const { busy, error, save } = useSave();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = e.currentTarget, data = new FormData(form);
    const input = Object.fromEntries(data);
    const ok = await save(`/api/goals/${goalId}/items${item ? `/${item.id}` : ""}`, item ? "PUT" : "POST", {
      ...input, quantity: Number(input.quantity), unitBudget: numeric(data, "unitBudget"), externalIds: item?.externalIds ?? {},
    });
    if (ok && !item) form.reset();
  };
  return <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-3">
    <label className="label">Game<select name="game" className="input" defaultValue={item?.game ?? "pokemon"}>{Object.entries(GAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label className="label sm:col-span-2">Card name<input name="name" className="input" required maxLength={500} defaultValue={item?.name} /></label>
    <label className="label">Set name<input name="setName" className="input" defaultValue={item?.setName ?? ""} /></label>
    <label className="label">Set code<input name="setCode" className="input" defaultValue={item?.setCode ?? ""} /></label>
    <label className="label">Collector number<input name="cardNumber" className="input" defaultValue={item?.cardNumber ?? ""} /></label>
    <label className="label">Printing (optional)<input name="variant" className="input" defaultValue={item?.variant ?? ""} placeholder="Any printing" /></label>
    <label className="label">Language (optional)<input name="language" className="input" defaultValue={item?.language ?? ""} placeholder="Any language" /></label>
    <label className="label">Target total copies<input name="quantity" className="input" type="number" min="1" max="1000000" step="1" defaultValue={item?.quantity ?? 1} required /></label>
    <label className="label">Price ceiling per copy (USD)<input name="unitBudget" className="input" type="number" min="0" step="0.01" defaultValue={item?.unitBudget ?? ""} placeholder="Unknown" /></label>
    <label className="label">Priority<select name="priority" className="input" defaultValue={item?.priority ?? "normal"}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
    <label className="label">Notes<input name="notes" className="input" maxLength={4000} defaultValue={item?.notes ?? ""} /></label>
    <div className="sm:col-span-3"><button className="btn-secondary" disabled={busy}>{busy ? "Saving…" : item ? "Save wanted card" : "Add wanted card"}</button></div>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 sm:col-span-3">{error}</p>}
  </form>;
}
function GoalCard({ goal }: { goal: Goal }) {
  const { busy, error, save } = useSave();
  const percent = goal.wanted ? Math.round(100 * goal.owned / goal.wanted) : 0;
  const priority = { high: 0, normal: 1, low: 2 };
  return <section className="card-surface space-y-4 p-4" aria-label={goal.name}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-display text-2xl font-semibold">{goal.name}</h2><p className="text-sm text-[var(--muted)]">{goal.owned} of {goal.wanted} copies owned · {percent}%{goal.targetDate ? ` · Target ${goal.targetDate}` : ""}{goal.archived ? " · Archived" : ""}</p></div>
      <button className="btn-secondary" disabled={busy} onClick={() => save(`/api/goals/${goal.id}`, "PUT", { ...goal, archived: !goal.archived })}>{goal.archived ? "Reopen goal" : "Archive goal"}</button>
    </div>
    <progress className="h-2 w-full accent-[var(--chart-series-3)]" aria-label={`${goal.name} progress`} value={goal.owned} max={Math.max(1, goal.wanted)} />
    <p className="text-sm">Planned remaining cost: <strong>{money(goal.remainingBudget)}</strong>{goal.budget === null ? " · No budget set" : ` of ${money(goal.budget)} budget`}.{goal.unbudgeted > 0 && ` ${goal.unbudgeted} wanted card${goal.unbudgeted === 1 ? " has" : "s have"} no price ceiling and are not included.`}{goal.budget !== null && goal.remainingBudget > goal.budget && " Your price ceilings exceed this budget."}</p>
    <p className="text-xs text-[var(--muted)]">Progress follows the copies you own now. Prices here are your shopping limits; purchases and sales stay in your collection records.</p>
    <ul className="divide-y divide-black/10 dark:divide-white/10">
      {[...goal.items].sort((a, b) => priority[a.priority] - priority[b.priority]).map((item) => <li key={item.id} className="space-y-2 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{item.name} {item.remaining === 0 && <span className="badge">Owned</span>}</h3><p className="text-xs text-[var(--muted)]">{[GAMES[item.game], item.setName, item.cardNumber && `#${item.cardNumber}`, item.variant, item.language].filter(Boolean).join(" · ")}</p><p className="text-sm">{item.owned}/{item.quantity} copies · {item.unitBudget === null ? "No price ceiling" : `${money(item.unitBudget)} per copy`} · {item.priority} priority</p>{item.notes && <p className="text-sm whitespace-pre-wrap">{item.notes}</p>}</div>
          <div className="flex gap-2">{item.remaining > 0 && <Link className="btn-secondary" href={`/add?goalItem=${item.id}`}>Add acquired card</Link>}<button className="btn-secondary" disabled={busy} aria-label={`Remove ${item.name} from goal`} onClick={() => { if (confirm(`Remove ${item.name} from this goal? Your collection is unchanged.`)) void save(`/api/goals/${goal.id}/items/${item.id}`, "DELETE"); }}>Remove</button></div>
        </div>
        <details><summary className="cursor-pointer text-sm underline">Edit wanted card</summary><WantedForm goalId={goal.id} item={item} /></details>
      </li>)}
    </ul>
    {!goal.items.length && <p className="text-sm text-[var(--muted)]">Add the cards you want below, or create a complete-set goal from Sets.</p>}
    <details><summary className="cursor-pointer font-medium">Add a wanted card</summary><WantedForm goalId={goal.id} /></details>
    <details><summary className="cursor-pointer text-sm underline">Edit goal</summary><div className="mt-3"><GoalForm goal={goal} /></div><button className="btn-secondary mt-3" disabled={busy} onClick={() => { if (confirm(`Delete the goal “${goal.name}” and its wishlist? Your cards are unchanged.`)) void save(`/api/goals/${goal.id}`, "DELETE"); }}>Delete goal</button></details>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  </section>;
}
export function Goals({ goals }: { goals: Goal[] }) {
  const [archived, setArchived] = useState(false);
  const shown = goals.filter((goal) => goal.archived === archived);
  return <div className="space-y-5">
    <section className="card-surface p-4"><h2 className="mb-3 font-semibold">New collecting goal</h2><GoalForm /></section>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Show archived goals</label>
    {shown.length ? shown.map((goal) => <GoalCard key={goal.id + goal.updatedAt} goal={goal} />) : <p className="card-surface p-6 text-sm text-[var(--muted)]">{archived ? "No archived goals." : "Start with a wishlist, or open a set checklist and choose Complete this set."}</p>}
  </div>;
}
