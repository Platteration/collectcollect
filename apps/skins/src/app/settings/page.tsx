import { getSettings } from "@/lib/settings";
import { providerStatuses } from "@/lib/status";
import { collectionStatus } from "@/lib/markdown/mirror";
import { dataDir } from "@/lib/db";
import { authEnabled } from "@/lib/auth";
import { backupSummary, replacedCollections } from "@/lib/backup";
import { SettingsForm } from "@/components/SettingsForm";
import { CollectionFiles } from "@/components/CollectionFiles";
import { Backup } from "@/components/Backup";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Settings</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Everything is kept in <code className="font-mono text-xs">{dataDir()}</code>, on this machine.{" "}
          {authEnabled()
            ? "A password is set, so this app asks for it once and then remembers the session."
            : "No password is set (SKINS_APP_PASSWORD), so anyone who can reach this page can change it."}
        </p>
      </header>

      <SettingsForm initial={getSettings()} providers={providerStatuses()} />

      <Backup summary={backupSummary()} replaced={replacedCollections()} />

      <CollectionFiles status={collectionStatus()} />
    </div>
  );
}
