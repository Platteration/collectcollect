import Link from "next/link";
import type { Engine } from "../domain/engine";
import { clientFields } from "../domain/spec";
import { isClaudeConfigured } from "../domain/identify";
import { AddItemFlow } from "../components/domain/AddItemFlow";
import { Heading } from "./shared";

export function AddPage<F extends object, S extends object, X extends object, Q>({ engine }: { engine: Engine<F, S, X, Q> }) {
  const { spec, repo } = engine;
  const hasIdentify = Boolean(spec.identify);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Heading
        title={`Add a ${spec.noun.singular}`}
        note={
          <>
            One at a time. For a whole collection,{" "}
            <Link href="/import" className="underline">
              import a spreadsheet
            </Link>{" "}
            instead.
          </>
        }
      />
      <AddItemFlow fields={clientFields(spec.fields)} noun={spec.noun} canIdentify={hasIdentify && isClaudeConfigured()} hasIdentify={hasIdentify} locations={repo.listLocations().map((l) => l.location)} />
    </div>
  );
}
