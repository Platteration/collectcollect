"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { Game } from "@/lib/types";

export function BrowseSet() {
  const router = useRouter();
  const [game, setGame] = useState("pokemon"), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const result = await api<{ setName: string }>("/api/sets/refresh", { method: "POST", body: JSON.stringify({ game, setName: data.get("setName"), setCode: data.get("setCode") ?? undefined }) });
      router.push(`/sets/${game}/${encodeURIComponent(result.setName)}`); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="card-surface space-y-3 p-4"><h2 className="font-semibold">Start a set before your first card</h2><form onSubmit={submit} className="flex flex-wrap items-end gap-3">
    <label className="label">Game<select className="input" value={game} onChange={(e) => setGame(e.target.value)}><option value="pokemon">Pokémon</option><option value="mtg">Magic: The Gathering</option><option value="yugioh">Yu-Gi-Oh!</option></select></label>
    <label className="label flex-1">Set name<input className="input" name="setName" required maxLength={500} placeholder={game === "pokemon" ? "Base" : game === "mtg" ? "Modern Horizons 2" : "Legend of Blue Eyes White Dragon"} /></label>
    {game === "mtg" && <label className="label">Set code<input className="input max-w-32" name="setCode" required maxLength={100} placeholder="MH2" /></label>}
    <button className="btn-primary" disabled={busy}>{busy ? "Fetching…" : "Open checklist"}</button>
  </form><p className="text-xs text-[var(--muted)]">Sports and other cards can be tracked in a manual collecting goal.</p>{error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}</section>;
}
export function SetGoalButton({ game, setId }: { game: Game; setId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true); setError(null);
    try { await api("/api/goals", { method: "POST", body: JSON.stringify({ fromSet: { game, setId } }) }); router.push("/goals"); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="mt-3"><button className="btn-primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Complete this set"}</button><p className="mt-1 text-xs text-[var(--muted)]">Creates a goal for one of each card, including the ones you already own.</p>{error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}</div>;
}
