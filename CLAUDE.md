@AGENTS.md

## Layout

An npm workspace: `apps/cards` (the trading-card app), `apps/skins` (the same engine for
CS2 items) and `packages/core` (code with no opinion about what is collected: the proxy
and its security headers, the password gate and sessions, forwarded-header trust, body
limits, restore validation, zip, CSV, charts). Each app is a Next.js app with its own
`AGENTS.md`/`CLAUDE.md`, which `next dev` writes and which are committed as it makes them.
`next` itself is declared once, in the root `package.json`, so both apps and the shared
package run the same version; `CONTRIBUTING.md` has what goes where.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. The repository's check command (`npm run check`, or
`ruff check .` then `pytest -q` in a Python repository) is the gate before a push. To
change a convention, change it in every repository in one pass and update the hashes in
the test.

## The website

Each app is a website served by its own Next server, which does the work a web host
would: `createProxy` in `packages/core/src/proxy.ts` runs for every path (each app's
`matcher` leaves out only the dev server's hot-reload socket) and sets every security
header per request, Next's `/_next/` files, the not-found page and every refusal
included; `next.config.ts` sets none, since a header frozen into the build could only
contradict it. The values are written out once more, in the README's two machine-read
blocks (`<!-- headers:cards:begin -->`, `headers:skins`): each app's
`tests/website.test.ts` holds the proxy's output equal to its block word for word, and
`e2e/website.spec.ts` holds every live response to it. Change one, change both. Every
source in the policy was measured in Chromium against the production build; add one only
when a spec shows something real needs it. Every spec imports `test` from
`e2e/fixtures.ts`, not `@playwright/test`, so every page any test drives fails on a policy
violation, an uncaught exception or a request that leaves the site; a new spec does the
same. API answers are `no-store` unless their path is on the app's `cachedPaths` (the
proxy's header wins over a route's own). Without a session, only each app's
`publicPaths` and the proxy's `SITE_PATHS` answer (`/_next/static`, `/robots.txt`,
`/.well-known/security.txt`, `/guard.js`). `/guard.js` is the safety net
(`packages/core/src/guard.ts`, loaded with the nonce, before the app; `Started` tells it
the page started, `NoScriptNote` covers no JavaScript at all). `public/.well-known/security.txt`
expires on 2027-10-08 and the unit test fails once it has. Each app lives at the root of
its own origin; there is no sub-path build. Trusted Types were measured and break Next's
chunk loader and the service worker's registration, so the policy does not require them.

## Settings

Each app keeps its settings server-side: one JSON record under the `settings` key of its
SQLite `settings` table, read and sanitised by `getSettings()`/`saveSettings()` in
`apps/cards/src/lib/settings.ts` and `apps/skins/src/lib/settings.ts` and edited on
`/settings`. Two preferences live in the browser instead, shared by both apps through
`packages/core`: the theme (`ThemeToggle`, localStorage `theme`: `system`, `light` or
`dark`; `system` follows `prefers-color-scheme`) and the accent (`ColorSchemePicker`,
localStorage `colorScheme`, one of `COLOR_SCHEMES` in `packages/core/src/color-schemes.ts`).
Both are read by literal comparison or a `Set` of the known ids, so a stored value that
names something on `Object.prototype` reads as the default; each layout's inline
`THEME_SCRIPT` applies them before the first paint and is kept in step with the two
components. Those two keys predate the shared settings contract and do not yet follow it
(`<app>.<record>.v<N>`, a `settings-contract` test): renaming them is a migration of its
own, not part of the merge that brought them here. Each control is its own reset, and
nothing about one is destructive, so nothing is confirmed. The About section on each
app's `/settings` takes its version from that app's `package.json` through
`src/lib/version.ts` (imported, since `npm_package_version` is unset under `next start`
and in the Docker image), which `/api/health` reports too and `tests/version.test.ts`
pins.
