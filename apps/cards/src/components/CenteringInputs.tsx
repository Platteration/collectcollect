"use client";

/** The four centering fields, as text: "55/45" or blank. */
export interface CenteringForm {
  centeringFrontLr: string;
  centeringFrontTb: string;
  centeringBackLr: string;
  centeringBackTb: string;
}

const FIELDS: Array<[keyof CenteringForm, string]> = [
  ["centeringFrontLr", "Front centering (left/right)"],
  ["centeringFrontTb", "Front centering (top/bottom)"],
  ["centeringBackLr", "Back centering (left/right)"],
  ["centeringBackTb", "Back centering (top/bottom)"],
];

/**
 * Where a card's borders are measured, written the way a grader writes it.
 * Inside a two-column fieldset: a heading row, the four inputs, a line of help.
 */
export function CenteringInputs({ value, onChange }: { value: CenteringForm; onChange: (next: Partial<CenteringForm>) => void }) {
  return (
    <>
      <div className="sm:col-span-2 mt-1 text-xs uppercase tracking-wide text-neutral-500">Centering</div>
      {FIELDS.map(([key, label]) => (
        <label key={key} className="block">
          <span className="label">{label}</span>
          <input className="input" value={value[key]} onChange={(e) => onChange({ [key]: e.target.value })} placeholder="55/45" inputMode="text" />
        </label>
      ))}
      <p className="sm:col-span-2 text-xs text-neutral-500">
        Write it the way a grader does, like 55/45 or 54L/46R. The first number is the left or top border. Leave blank if it has not been measured.
      </p>
    </>
  );
}
