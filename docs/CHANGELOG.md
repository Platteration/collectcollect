# Unreleased candidate

This candidate targets a self-hosted, single-owner installation. Public publishing remains disabled pending the project-license decision.

- Photo scans retain drafts, edited identifications, uncertainty and duplicate decisions across reloads. Confident results save automatically; uncertain results stay in the review inbox. Interrupted identification can be retried without adding a second card.
- Goals and wishlists track desired quantities, variants, budgets and acquisition progress. A physical copy counts once within a goal. Goals travel with full backups and Markdown downloads.
- Individual purchases can be corrected, including previously unknown costs. Purchases already used in sales keep their financial fields fixed until those sales are undone.
- Portfolio history now records holdings as they change. Existing collections begin at an explicit opening balance on upgrade; earlier holdings are not reconstructed. The separate price-history view continues to use today's quantities. Collection value changes include purchases and sales and are not investment returns.
- Price refreshes have persistent progress, item-level results and retries for unfinished work. Grading comparisons label measured and estimated bounds separately and require observations on three distinct days for historical comparisons.
- Authentication rejects forged logout tokens, limits concurrent login attempts and binds sessions to password changes. **Existing sessions expire on upgrade; sign in again.**
- Backups stage a consistent database and photo snapshot. Restores validate and migrate a private staging copy before replacing live data; a recovery journal rolls back interrupted swaps. Keep a pre-upgrade full backup for rollback to an older application version.
- A photo the collection names but the uploads folder lacks no longer blocks a backup, a restore or a put-back: the backup leaves it out and names the card; a restore clears the reference on its staging copy and lists it. A restore waits for background single-card lookups instead of refusing over them. A rollback that finds two copies of a folder keeps both and records the pair; `/api/health` reports `database` from a real query rather than the file's existence.
- Steam imports apply the exact reviewed inventory snapshot. Display fonts are bundled so production builds do not need Google Fonts access.

See [self-hosting and recovery](SELF_HOSTING.md) for installation, supported process layout, candidate images and rollback instructions.
