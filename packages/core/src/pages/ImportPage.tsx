import type { Engine } from "../domain/engine";
import { fieldByKey } from "../domain/spec";
import { CsvImport } from "../components/domain/CsvImport";
import { exampleCsv, Heading } from "./shared";

export function ImportPage<F extends object, S extends object, X extends object, Q>({ engine, children }: { engine: Engine<F, S, X, Q>; children?: React.ReactNode }) {
  const { spec } = engine;
  const title = fieldByKey(spec, spec.titleField)?.label ?? spec.titleField;
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <Heading title={`Bring ${spec.noun.plural} in`} note="Nothing is written until you have seen what would arrive." />
      {children}
      <div>
        <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">From a spreadsheet</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          A CSV with a header row. Columns are matched by name, so the order does not matter and columns the app does not know are ignored. A row that
          matches something already held and is not one specific object joins its stack.
        </p>
        <CsvImport titleField={title} noun={spec.noun} example={exampleCsv(spec)} />
      </div>
    </div>
  );
}
