# Running CollectCollect yourself

CollectCollect is a single-owner collection on your machine or private network. Each app has a separate database and password. Start with cards; skins is optional.

Run exactly one app process for each data directory. SQLite data, upload snapshots, restore locks and background work belong to that process; do not share a volume between replicas. Keep the database and its data directory on the same filesystem for online restore.

## First installation

Install Docker with Compose support. From an authorized checkout:

```sh
cp .env.example .env
docker compose up -d --build cards
```

On PowerShell use `Copy-Item .env.example .env`. Open `http://localhost:3000`. Manual entry, CSV imports, purchases and goals need no API keys. The setup checklist links to those steps and can be reopened in Settings.

For photo identification add `ANTHROPIC_API_KEY` to `.env`; for paid graded prices add `PRICECHARTING_TOKEN`. Apply environment changes with `docker compose up -d --force-recreate cards`. Settings distinguishes configuration from a tested connection. A connection test makes a small provider request; the vision check asks whether the configured model is available without sending a photo.

The named `collectcollect-data` volume holds `/data`. Container replacement preserves it. Do not use `docker compose down -v` when keeping your collection: that removes its volume. Start skins separately with `docker compose up -d --build skins` on port 3001.

## Remote access

Keep the default localhost bindings. Set a strong `APP_PASSWORD` (and `SKINS_APP_PASSWORD` for skins), and place an HTTPS reverse proxy in front. Set `TRUST_PROXY=1` only when the proxy replaces forwarded headers. The apps do not serve TLS. Serve cards and skins on distinct origins because their service workers each own their origin. This remains one shared collection with no separate user accounts.

## Backup, update and recovery

1. Download a full backup from Settings before updating; keep it outside the Docker volume. It includes the database and photos, with goals in the database.
2. Check out the intended version, read [release notes](CHANGELOG.md), and run `docker compose up -d --build cards`. Schema additions apply when the database opens. Check `/api/health`, open a card and goal, and verify your history.
3. For recovery, stop the app and preserve a copy of the current volume first. Run the previous version with a separate volume and restore the matching pre-update backup. Do not point an older version at a database migrated by a newer version.
4. Settings retains the collection replaced during a restore, allowing undo. Follow its size guidance for archives too large for a browser upload; unpack only with the app stopped.

Markdown downloads include readable card files and `goals/goal-<id>.md` files. Each goal includes its wishlist and a JSON record for repeatable restoration. Photos are included only in the full backup. Unknown goal files are preserved when rewriting, so a surviving copy can be read back into a fresh database.

## Release status

Public image publication is disabled. The manual release-candidate workflow accepts a version, validates and builds a local cards image, checks goal persistence over a container restart, and uploads an image archive, candidate Compose file and these instructions as a workflow artifact. It has no registry credentials or publishing permissions. No project license has been selected. The license decision and explicit publication enablement remain separate release steps; this guide does not assume a public image exists.

To test an artifact, load its image with `docker load -i collectcollect-cards-<version>.tar.gz`, then run `docker compose --env-file candidate.env -f compose.candidate.yaml up -d`. It uses the separate `collectcollect-candidate-data` volume. Stop your normal app first if it uses port 3000. Restore a copy of your backup into the candidate when checking upgrades; keep the original backup unchanged.

The display font is bundled for reproducible builds without Google Fonts access. Its upstream OFL license is included with the font; that license is separate from the deferred project-license decision.

Before publication, require passing checks for the exact release commit: lint, types, unit tests, both browser suites, Docker startup/shutdown, restart persistence, and restoration of a previous-version backup. Only then create versioned images after the license decision.
