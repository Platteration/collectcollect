"use client";

import { CONDITIONS, GAMES, GAME_IDS, GRADING_COMPANIES, type CardInput, type Game } from "@/lib/types";

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
  quantity: string;
  condition: string;
  gradingCompany: string;
  grade: string;
  certNumber: string;
  purchasePrice: string;
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
  quantity: "1",
  condition: "NM",
  gradingCompany: "",
  grade: "",
  certNumber: "",
  purchasePrice: "",
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
    quantity: s(card.quantity ?? 1),
    condition: s(card.condition ?? "NM"),
    gradingCompany: s(card.gradingCompany),
    grade: s(card.grade),
    certNumber: s(card.certNumber),
    purchasePrice: s(card.purchasePrice),
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
    quantity: n(f.quantity) ?? 1,
    condition: (f.condition || "NM") as CardInput["condition"],
    gradingCompany: t(f.gradingCompany),
    grade: t(f.grade),
    certNumber: t(f.certNumber),
    purchasePrice: n(f.purchasePrice),
    notes: t(f.notes),
  };
}

interface Props {
  value: CardFormState;
  onChange: (next: CardFormState) => void;
  disabled?: boolean;
}

export function CardForm({ value, onChange, disabled }: Props) {
  const set = (key: keyof CardFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [key]: e.target.value });
  const isSports = value.game === "sports";
  const isGraded = value.gradingCompany !== "" || value.grade !== "";

  return (
    <fieldset disabled={disabled} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="label">Game / category</label>
        <select className="input" value={value.game} onChange={set("game")}>
          {GAME_IDS.map((g) => (
            <option key={g} value={g}>
              {GAMES[g]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">{isSports ? "Player" : "Card name"}</label>
        <input className="input" value={value.name} onChange={set("name")} required />
      </div>
      {isSports && (
        <div>
          <label className="label">Sport</label>
          <input className="input" value={value.sport} onChange={set("sport")} placeholder="baseball" />
        </div>
      )}
      {isSports && (
        <div>
          <label className="label">Manufacturer / brand</label>
          <input className="input" value={value.manufacturer} onChange={set("manufacturer")} placeholder="Topps" />
        </div>
      )}
      <div>
        <label className="label">Set / product</label>
        <input className="input" value={value.setName} onChange={set("setName")} placeholder={isSports ? "2011 Topps Update" : "Base Set"} />
      </div>
      <div>
        <label className="label">Set code</label>
        <input className="input" value={value.setCode} onChange={set("setCode")} placeholder={value.game === "yugioh" ? "LOB" : value.game === "mtg" ? "MH2" : ""} />
      </div>
      <div>
        <label className="label">Card number</label>
        <input className="input" value={value.cardNumber} onChange={set("cardNumber")} placeholder={value.game === "pokemon" ? "4/102" : "#"} />
      </div>
      <div>
        <label className="label">Year</label>
        <input className="input" value={value.year} onChange={set("year")} inputMode="numeric" />
      </div>
      <div>
        <label className="label">Rarity</label>
        <input className="input" value={value.rarity} onChange={set("rarity")} />
      </div>
      <div>
        <label className="label">Variant</label>
        <input className="input" value={value.variant} onChange={set("variant")} placeholder="holo, 1st edition, refractor…" />
      </div>
      <div>
        <label className="label">Language</label>
        <input className="input" value={value.language} onChange={set("language")} placeholder="English" />
      </div>
      <div>
        <label className="label">Quantity</label>
        <input className="input" value={value.quantity} onChange={set("quantity")} inputMode="numeric" />
      </div>

      <div className="sm:col-span-2 mt-2 border-t border-black/10 pt-3 text-sm font-medium dark:border-white/10">
        Your copy
      </div>
      <div>
        <label className="label">Grading company</label>
        <select className="input" value={value.gradingCompany} onChange={set("gradingCompany")}>
          <option value="">Not graded (raw)</option>
          {GRADING_COMPANIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {isGraded ? (
        <>
          <div>
            <label className="label">Grade</label>
            <input className="input" value={value.grade} onChange={set("grade")} placeholder="10" />
          </div>
          <div>
            <label className="label">Cert number</label>
            <input className="input" value={value.certNumber} onChange={set("certNumber")} />
          </div>
        </>
      ) : (
        <div>
          <label className="label">Condition</label>
          <select className="input" value={value.condition} onChange={set("condition")}>
            {Object.entries(CONDITIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {k} · {label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="label">Purchase price (USD)</label>
        <input className="input" value={value.purchasePrice} onChange={set("purchasePrice")} inputMode="decimal" />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Notes</label>
        <textarea className="input" rows={2} value={value.notes} onChange={set("notes")} />
      </div>
    </fieldset>
  );
}
