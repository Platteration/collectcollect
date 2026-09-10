"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { CONDITIONS, GAMES, GAME_IDS, GRADING_COMPANIES, SUBGRADE_KEYS, type CardInput, type Game, type Subgrades } from "@/lib/types";

/** String-typed form state; converted to CardInput on submit. */
export interface CardFormState {
  game: Game;
  name: string;
  sport: string;
  setName: string;
  setCode: string;
  cardNumber: string;
  year: string;
  rarity: string;
  variant: string;
  language: string;
  manufacturer: string;
  team: string;
  /** "true" or "" like a checkbox. */
  rookie: string;
  parallel: string;
  serialNumber: string;
  autograph: string;
  relic: string;
  quantity: string;
  condition: string;
  gradingCompany: string;
  grade: string;
  certNumber: string;
  /** BGS subgrades as typed, one field each. */
  centering: string;
  corners: string;
  edges: string;
  surface: string;
  purchasePrice: string;
  location: string;
  notes: string;
}

export const emptyForm = (game: Game = "pokemon"): CardFormState => ({
  game,
  name: "",
  sport: "",
  setName: "",
  setCode: "",
  cardNumber: "",
  year: "",
  rarity: "",
  variant: "",
  language: "",
  manufacturer: "",
  team: "",
  rookie: "",
  parallel: "",
  serialNumber: "",
  autograph: "",
  relic: "",
  quantity: "1",
  condition: "NM",
  gradingCompany: "",
  grade: "",
  certNumber: "",
  centering: "",
  corners: "",
  edges: "",
  surface: "",
  purchasePrice: "",
  location: "",
  notes: "",
});

export function formFromCard(card: Partial<CardInput> & { game: Game; name: string }): CardFormState {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    game: card.game,
    name: card.name,
    sport: s(card.sport),
    setName: s(card.setName),
    setCode: s(card.setCode),
    cardNumber: s(card.cardNumber),
    year: s(card.year),
    rarity: s(card.rarity),
    variant: s(card.variant),
    language: s(card.language),
    manufacturer: s(card.manufacturer),
    team: s(card.team),
    rookie: card.rookie ? "true" : "",
    parallel: s(card.parallel),
    serialNumber: s(card.serialNumber),
    autograph: card.autograph ? "true" : "",
    relic: card.relic ? "true" : "",
    quantity: s(card.quantity ?? 1),
    condition: s(card.condition ?? "NM"),
    gradingCompany: s(card.gradingCompany),
    grade: s(card.grade),
    certNumber: s(card.certNumber),
    centering: s(card.subgrades?.centering),
    corners: s(card.subgrades?.corners),
    edges: s(card.subgrades?.edges),
    surface: s(card.subgrades?.surface),
    purchasePrice: s(card.purchasePrice),
    location: s(card.location),
    notes: s(card.notes),
  };
}

export function formToInput(f: CardFormState): CardInput {
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  const t = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    game: f.game,
    name: f.name.trim(),
    sport: t(f.sport),
    setName: t(f.setName),
    setCode: t(f.setCode),
    cardNumber: t(f.cardNumber),
    year: n(f.year),
    rarity: t(f.rarity),
    variant: t(f.variant),
    language: t(f.language),
    manufacturer: t(f.manufacturer),
    team: t(f.team),
    rookie: f.rookie === "true",
    parallel: t(f.parallel),
    serialNumber: t(f.serialNumber),
    autograph: f.autograph === "true",
    relic: f.relic === "true",
    quantity: n(f.quantity) ?? 1,
    condition: (f.condition || "NM") as CardInput["condition"],
    gradingCompany: t(f.gradingCompany),
    grade: t(f.grade),
    certNumber: t(f.certNumber),
    subgrades: subgradesFromForm(f),
    purchasePrice: n(f.purchasePrice),
    location: t(f.location),
    notes: t(f.notes),
  };
}

function subgradesFromForm(f: CardFormState): Subgrades | null {
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  const out = { centering: n(f.centering), corners: n(f.corners), edges: n(f.edges), surface: n(f.surface) };
  return SUBGRADE_KEYS.some((k) => out[k] !== null) ? out : null;
}

interface Props {
  value: CardFormState;
  onChange: (next: CardFormState) => void;
  disabled?: boolean;
}

export function CardForm({ value, onChange, disabled }: Props) {
  // Offer the places cards are already kept, so locations stay consistent
  // instead of becoming "Binder 2", "binder2" and "Binder two".
  const [locations, setLocations] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api<{ locations: Array<{ location: string }> }>("/api/locations")
      .then((res) => {
        if (!cancelled) setLocations(res.locations.map((l) => l.location));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: keyof CardFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [key]: e.target.value });
  const toggle = (key: "rookie" | "autograph" | "relic") => () => onChange({ ...value, [key]: value[key] === "true" ? "" : "true" });
  const isSports = value.game === "sports";
  const isGraded = value.gradingCompany !== "" || value.grade !== "";
  const isBgs = value.gradingCompany.toUpperCase() === "BGS";

  return (
    <fieldset disabled={disabled} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="label">Game / category</span>
        <select className="input" value={value.game} onChange={set("game")}>
          {GAME_IDS.map((g) => (
            <option key={g} value={g}>
              {GAMES[g]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">{isSports ? "Player" : "Card name"}</span>
        <input className="input" value={value.name} onChange={set("name")} required />
      </label>
      {isSports && (
        <label className="block">
          <span className="label">Sport</span>
          <input className="input" value={value.sport} onChange={set("sport")} placeholder="baseball" />
        </label>
      )}
      {isSports && (
        <label className="block">
          <span className="label">Manufacturer / brand</span>
          <input className="input" value={value.manufacturer} onChange={set("manufacturer")} placeholder="Topps" />
        </label>
      )}
      {isSports && (
        <label className="block">
          <span className="label">Team</span>
          <input className="input" value={value.team} onChange={set("team")} placeholder="Los Angeles Angels" />
        </label>
      )}
      {isSports && (
        <label className="block">
          <span className="label">Parallel / refractor</span>
          <input className="input" value={value.parallel} onChange={set("parallel")} placeholder="Gold Refractor, Silver Prizm" />
        </label>
      )}
      {isSports && (
        <label className="block">
          <span className="label">Serial number</span>
          <input className="input" value={value.serialNumber} onChange={set("serialNumber")} placeholder="12/99" />
        </label>
      )}
      {isSports && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 self-end pb-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={value.rookie === "true"} onChange={toggle("rookie")} />
            Rookie card
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={value.autograph === "true"} onChange={toggle("autograph")} />
            Autograph
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={value.relic === "true"} onChange={toggle("relic")} />
            Relic / patch
          </label>
        </div>
      )}
      <label className="block">
        <span className="label">Set / product</span>
        <input className="input" value={value.setName} onChange={set("setName")} placeholder={isSports ? "2011 Topps Update" : "Base Set"} />
      </label>
      <label className="block">
        <span className="label">Set code</span>
        <input className="input" value={value.setCode} onChange={set("setCode")} placeholder={value.game === "yugioh" ? "LOB" : value.game === "mtg" ? "MH2" : ""} />
      </label>
      <label className="block">
        <span className="label">Card number</span>
        <input className="input" value={value.cardNumber} onChange={set("cardNumber")} placeholder={value.game === "pokemon" ? "4/102" : "#"} />
      </label>
      <label className="block">
        <span className="label">Year</span>
        <input className="input" value={value.year} onChange={set("year")} inputMode="numeric" />
      </label>
      <label className="block">
        <span className="label">Rarity</span>
        <input className="input" value={value.rarity} onChange={set("rarity")} />
      </label>
      <label className="block">
        <span className="label">Variant</span>
        <input className="input" value={value.variant} onChange={set("variant")} placeholder="holo, 1st edition, refractor…" />
      </label>
      <label className="block">
        <span className="label">Language</span>
        <input className="input" value={value.language} onChange={set("language")} placeholder="English" />
      </label>
      <label className="block">
        <span className="label">Quantity</span>
        <input className="input" value={value.quantity} onChange={set("quantity")} inputMode="numeric" />
      </label>

      <div className="sm:col-span-2 mt-2 border-t border-black/10 pt-3 text-sm font-medium dark:border-white/10">
        Your copy
      </div>
      <label className="block">
        <span className="label">Grading company</span>
        <select className="input" value={value.gradingCompany} onChange={set("gradingCompany")}>
          <option value="">Not graded (raw)</option>
          {GRADING_COMPANIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {isGraded ? (
        <>
          <label className="block">
            <span className="label">Grade</span>
            <input className="input" value={value.grade} onChange={set("grade")} placeholder="10" />
          </label>
          <label className="block">
            <span className="label">Cert number</span>
            <input className="input" value={value.certNumber} onChange={set("certNumber")} />
          </label>
          {isBgs && (
            <div className="grid grid-cols-4 gap-2 sm:col-span-2">
              {(["centering", "corners", "edges", "surface"] as const).map((k) => (
                <label key={k} className="block">
                  <span className="label capitalize">{k}</span>
                  <input className="input" value={value[k]} onChange={set(k)} inputMode="decimal" placeholder="9.5" />
                </label>
              ))}
            </div>
          )}
        </>
      ) : (
        <label className="block">
          <span className="label">Condition</span>
          <select className="input" value={value.condition} onChange={set("condition")}>
            {Object.entries(CONDITIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {k} · {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="label">Purchase price (USD)</span>
        <input className="input" value={value.purchasePrice} onChange={set("purchasePrice")} inputMode="decimal" />
      </label>
      <label className="block">
        <span className="label">Kept in</span>
        <input className="input" value={value.location} onChange={set("location")} placeholder="Binder 2, page 4" list="known-locations" />
        {locations.length > 0 && (
          <datalist id="known-locations">
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        )}
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes</span>
        <textarea className="input" rows={2} value={value.notes} onChange={set("notes")} />
      </label>
    </fieldset>
  );
}
