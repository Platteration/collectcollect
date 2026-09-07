import { SettingsForm } from "@/components/SettingsForm";
import { getSettings } from "@/lib/settings";
import { backupSummary } from "@/lib/backup";
import { RestoreForm } from "@/components/RestoreForm";
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
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

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

      <SettingsForm initial={getSettings()} />
    </div>
  );
}
