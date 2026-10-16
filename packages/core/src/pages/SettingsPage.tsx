import type { Engine } from "../domain/engine";
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
      <SettingsForm fields={engine.settings.fields} initial={engine.settings.getSettings() as Record<string, unknown>} providers={engine.statuses()} />
      <CollectionFiles status={engine.mirror.collectionStatus()} noun={spec.noun} backup={engine.backup.backupSummary()} />
    </div>
  );
}
