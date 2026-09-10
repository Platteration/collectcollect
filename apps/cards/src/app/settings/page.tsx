import { SettingsForm } from "@/components/SettingsForm";
import { getSettings } from "@/lib/settings";
import { backupSummary } from "@/lib/backup";
import { RestoreForm } from "@/components/RestoreForm";
import { CollectionFiles } from "@/components/CollectionFiles";
import { collectionStatus } from "@/lib/markdown/mirror";
import Link from "next/link";
import { providerStatuses } from "@/lib/status";
import { GAMES } from "@/lib/types";

export const dynamic = "force-dynamic";

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SettingsPage() {
  const providers = providerStatuses();
  const backup = backupSummary();
  const collection = collectionStatus();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Settings</h1>

      {/* The phone tab bar holds five destinations; these are the rest. */}
      <nav className="card-surface p-4 md:hidden" aria-label="More sections">
        <h2 className="font-semibold">Go to</h2>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {[
            { href: "/add", label: "Add cards" },
            { href: "/scan", label: "Scan a stack" },
            { href: "/submissions", label: "Grading submissions" },
            { href: "/report", label: "Appraisal report" },
            { href: "/import", label: "Import a CSV" },
          ].map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="btn-secondary w-full justify-start">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="card-surface p-4">
        <h2 className="font-semibold">Data sources</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Configured through environment variables (see <code>.env.example</code>). Restart the server after changing them.
        </p>
        <ul className="mt-3 divide-y divide-black/5 dark:divide-white/5">
          {providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div>
                <div className="font-medium">{p.label}</div>
                <div className="text-xs text-neutral-500">{p.note}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.games.map((g) => (
                    <span key={g} className="badge bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {GAMES[g]}
                    </span>
                  ))}
                </div>
              </div>
              <span className={`badge ${p.configured ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"}`}>
                {p.configured ? "Ready" : p.optional ? "Not configured" : "Missing"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-surface p-4">
        <h2 className="font-semibold">Backup</h2>
        <p className="mt-1 text-sm text-neutral-500">
          One zip holding a consistent copy of the database and every photo: {backup.photos} photo
          {backup.photos === 1 ? "" : "s"} ({mb(backup.photoBytes)}) plus a {mb(backup.databaseBytes)} database.
        </p>
        <a href="/api/backup" className="btn-secondary mt-3 inline-flex" download>
          Download backup
        </a>
        <RestoreForm />
      </section>

      <section className="card-surface p-4">
        <h2 className="font-semibold">Your collection in plain text</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Every card is also written as a Markdown file, kept up to date as you go. They are meant to outlive this app:
          a folder of readable files that any editor, spreadsheet or notes tool can open, and that this app can read
          back.
        </p>
        {/* A path has no spaces to wrap at, so it has to be allowed to break anywhere. */}
        <p className="mt-2 break-all font-mono text-xs text-neutral-500">{collection.dir}</p>
        <p className="mt-2 text-sm">
          {collection.enabled ? (
            <>
              {collection.files} file{collection.files === 1 ? "" : "s"} ({mb(collection.bytes)})
              {collection.updatedAt ? `, last written ${new Date(collection.updatedAt).toLocaleString()}` : ""}.
            </>
          ) : (
            <>Switched off by <code>MARKDOWN_MIRROR=off</code>.</>
          )}
        </p>
        {collection.enabled && collection.files < collection.cards && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
            {collection.cards - collection.files} card{collection.cards - collection.files === 1 ? " is" : "s are"} not
            written yet. Rewrite the files to catch up.
          </p>
        )}
        {collection.lastError && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
            {collection.failures} write{collection.failures === 1 ? "" : "s"} did not land. Last problem:{" "}
            {collection.lastError}. Your cards are safe in the database; rewrite the files below once the cause is fixed.
          </p>
        )}
        <CollectionFiles enabled={collection.enabled} />
      </section>

      <SettingsForm initial={getSettings()} />
    </div>
  );
}
