@AGENTS.md

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. `npm run check` is the gate before a push. To change a
convention, change it in every repository in one pass and update the hashes in the test.

## Settings

The only settings are server-side: one JSON record under the `settings` key of the
SQLite `settings` table, read and sanitised by `getSettings()`/`saveSettings()` in
`src/lib/settings.ts` and edited on `/settings`; there is no client preference store
(the app follows the OS colour scheme), so there is no theme, sound or motion row and no
storage-key validator or `settings-contract` test. The About footer on `/settings` takes
its version from `package.json` (imported into the server component, since
`npm_package_version` is unset under `next start` in the Docker image).
