import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { providerStatuses } from "@/lib/status";
import { collectionStatus } from "@/lib/markdown/mirror";
import { dataDir, databaseFile, recoveryConflicts } from "@/lib/db";
import { recoveryConflictsFile } from "@collectcollect/core/collection-swap";
import { RecoveryNotice } from "@collectcollect/core/components/RecoveryNotice";
import { SESSION_DAYS, authEnabled } from "@/lib/auth";
import { SignOut } from "@collectcollect/core/components/SignOut";
import { ColorSchemePicker } from "@collectcollect/core/components/ColorSchemePicker";
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

      <RecoveryNotice record={recoveryConflicts()} file={recoveryConflictsFile(databaseFile())} noun="inventory" />

      <section className="card-surface p-4">
        <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Appearance</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Pick an accent color. Saved on this device, like light/dark. A gain or loss is always green or red,
          whichever you choose.
        </p>
        <div className="mt-3">
          <ColorSchemePicker />
        </div>
      </section>

      {authEnabled() && (
        <section className="card-surface p-4">
          <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Sessions</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Every device that gave the password stays signed in for {SESSION_DAYS} days. If one of them is lost, or was
            left signed in somewhere, end every session at once; each will ask for the password again.
          </p>
          <div className="mt-3">
            <SignOut everywhere />
          </div>
        </section>
      )}

      {/* The phone tab bar holds five destinations; these are the rest. */}
      <nav className="card-surface p-4 md:hidden" aria-label="More sections">
        <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Go to</h2>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {[
            { href: "/add", label: "Add an item" },
            { href: "/import", label: "Import an inventory" },
            { href: "/report", label: "Valuation report" },
          ].map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="btn-secondary w-full justify-start">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <SettingsForm initial={getSettings()} providers={providerStatuses()} />

      <Backup summary={backupSummary()} replaced={replacedCollections()} />

      <CollectionFiles status={collectionStatus()} />
    </div>
  );
}
