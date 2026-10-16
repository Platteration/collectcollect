import type { Engine } from "../domain/engine";
import { ColorSchemePicker } from "../components/ColorSchemePicker";
import { CollectionFiles } from "../components/domain/CollectionFiles";
import { SettingsForm } from "../components/domain/SettingsForm";
import { Heading } from "./shared";

export function SettingsPage<F extends object, S extends object, X extends object, Q>({ engine }: { engine: Engine<F, S, X, Q> }) {
  const { spec } = engine;
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <Heading
        title="Settings"
        note={
          <>
            Everything is kept in <code className="font-mono text-xs">{engine.db.dataDir()}</code>, on this machine.{" "}
            {engine.auth.authEnabled()
              ? "A password is set, so this app asks for it once and then remembers the session."
              : `No password is set (${spec.envPrefix}_APP_PASSWORD), so anyone who can reach this page can change it.`}
          </>
        }
      />
      <section className="card-surface p-4">
        <h2 className="font-semibold">Appearance</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Pick an accent color. Saved on this device, like light/dark. A gain or loss is always green or red,
          whichever you choose.
        </p>
        <div className="mt-3">
          <ColorSchemePicker />
        </div>
      </section>
      <SettingsForm fields={engine.settings.fields} initial={engine.settings.getSettings() as Record<string, unknown>} providers={engine.statuses()} />
      <CollectionFiles status={engine.mirror.collectionStatus()} noun={spec.noun} backup={engine.backup.backupSummary()} />
    </div>
  );
}
