import type { RecoveryConflicts } from "../collection-swap";

/**
 * What an interrupted restore's rollback found in two places and left alone.
 *
 * A rename is atomic on every filesystem the app runs on, so two copies mean a
 * filesystem that renames by copying, or a hand that moved something. Guessing
 * which copy is the collection is how a restore loses one, so recovery keeps
 * both, starts the app on the paths the journal identifies, and says so here
 * until a person has looked or a later restore has settled the question.
 */
export function RecoveryNotice({ record, file, noun }: { record: RecoveryConflicts | null; file: string; noun: string }) {
  if (!record) return null;
  return (
    <section className="card-surface p-4" role="alert">
      <h2 className="font-semibold text-amber-700 dark:text-amber-300">A restore was interrupted, and its recovery found two copies</h2>
      <p className="mt-1 text-sm">
        Recovery left both copies of each pair below where they are rather than guess which one is your {noun}. The app is running on
        the copy at the {noun}&apos;s own paths. Compare each pair and move the one you do not want out of the data directory. This
        notice clears when a later restore or put-back completes, or when the record file is deleted.
      </p>
      <ul className="mt-2 space-y-1 break-all font-mono text-xs">
        {record.conflicts.map((c) => (
          <li key={`${c.from} -> ${c.to}`}>
            {c.from} <span aria-hidden="true">↔</span>
            <span className="sr-only">and</span> {c.to}
          </li>
        ))}
      </ul>
      {record.kept.length > 0 && (
        <p className="mt-2 break-all font-mono text-xs">Staging files kept, in case a copy is in them: {record.kept.join(", ")}</p>
      )}
      <p className="mt-2 break-all font-mono text-xs">Record: {file}</p>
    </section>
  );
}
