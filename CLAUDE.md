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
`e2e/website.spec.ts` holds every live response to it. Change one, change both. An
address with a trailing slash is redirected by the proxy (each `next.config.ts` sets
`skipTrailingSlashRedirect`, since Next's own redirect runs before the proxy and carried
no header); Next's repeated-slash redirect and its 500 for `TRACE`, and Node's own 400
for an unknown method and 431 for oversized headers, still leave without them, and
`website.spec.ts` pins all four, so the README's sentence about them changes when Next or
Node does. What only https may carry — HSTS, `upgrade-insecure-requests`, an https
`Origin` on a write — is decided per request by `servedOverHttps` in
`packages/core/src/net.ts`: a trusted proxy's `X-Forwarded-Proto`, or a request sent to
the https address `APP_BASE_URL` names. Never the request URL's scheme, which Next writes
from any client's `X-Forwarded-Proto`, and never for the whole deployment: a LAN name
listed beside the domain is plain http, and the cards suite's locked server is set up
that way (`auth.spec.ts` drives it through a `.lan` name). Every source in the policy
was measured in Chromium against the production build, by taking it out and seeing a spec
go red (but `script-src`'s `'self'`, a fallback
Chromium ignores beside `'strict-dynamic'`, and `worker-src`, which it fills from
`script-src`: README, "The website"); add one only when a spec shows something real
needs it. Every spec imports `test` from `e2e/fixtures.ts`, not
`@playwright/test` (`tests/website.test.ts` fails on one that does not), so every page any
test drives, in a context the test makes for itself too, fails on a policy violation, an
uncaught exception or a request that leaves the site; `unwatchedContext` is for a test
whose pages break those rules on purpose. `website.spec.ts` starts every page the app
has, read off `src/app`: a new page fails it until the walk has an address for it. In
skins an item's picture is drawn only from the hosts `IMAGE_SOURCES` names
(`src/lib/images.ts`), which is also the policy's `img-src`, so a host added to one is in
the other; in cards an outside picture is drawn only over https (`shownImage` in
`src/lib/format.ts`), which is what its `img-src` allows. `public/` is served whole, so it
holds only what a page loads: a source such as the skins icon's SVG lives beside the
script that uses it. API answers are `no-store` unless their path is on the app's
`cachedPaths` (the proxy's header wins over a route's own). Without a session, only each app's
`publicPaths` and the proxy's `SITE_PATHS` answer (`/_next/static`, `/robots.txt`,
`/.well-known/security.txt`, `/guard.js`). `/guard.js` is the safety net
(`packages/core/src/guard.ts`, loaded with the nonce, before the app; `Started` tells it
the page started, `NoScriptNote` covers no JavaScript at all). `public/.well-known/security.txt`
expires on 2027-10-08 and the unit test fails once it has. Each app lives at the root of
its own origin; there is no sub-path build. Trusted Types were measured and break Next's
chunk loader and the service worker's registration, so the policy does not require them.

## Input from outside

A file read back in, a spreadsheet, a restored database and a request body are all
text someone else may have written, up to 64 MB (8 MB for a spreadsheet), and parsing
runs on the one thread every request shares. So a parser over such text must not let
two of a pattern's quantifiers share one run of characters (`\s*%?\s*`, a lazy `(.*?)`
before `\s*$`) unless the run is bounded first, as `spaced` in `centering.ts` makes
every run of spaces one: each of those held the whole server for seconds, and the
centering one for more than five minutes, on a few hundred bytes to a few hundred
kilobytes of crafted text, and the `linear-parsing` tests in both apps hold each reader
they replaced to a budget on such input, and to reading exactly what its pattern read on
seeded short inputs drawn from the characters that matter (brackets, every line break).
A stored row is read back field by field rather than trusted for its shape
(`readPriceSummary`, `decode` in `scan-drafts.ts`, `readStored` and the JSON-column
readers beside it in `cards.ts`): a restore installs rows this app never wrote, and a
reader that indexes into one it cannot read takes every page that lists
it down. An import reads at most `MAX_IMPORT_ROWS` rows in each app.

## Settings

Each app keeps its settings server-side: one JSON record under the `settings` key of its
SQLite `settings` table, read and sanitised by `getSettings()`/`saveSettings()` in
`apps/cards/src/lib/settings.ts` and `apps/skins/src/lib/settings.ts` and edited on
`/settings`. Two preferences live in the browser instead, shared by both apps through
`packages/core`: the theme (localStorage `theme`: `system`, `light` or `dark`; `system`
follows `prefers-color-scheme`) and the palette (localStorage `colorScheme`, one of
`COLOR_SCHEMES` in `packages/core/src/color-schemes.ts`, whose grounds, panels and accents
are `packages/core/src/family-theme.css`). One controller, `packages/core/src/appearance.ts`,
reads, stores and applies both for `ThemeToggle` (the header's switch and palette menu) and
`ColorSchemePicker` (Settings), keeps a choice the browser will not store in memory with a
note, and keeps tabs in step. It reads both by literal comparison against the known ids, so
a stored value that names something on `Object.prototype` reads as the default. Each
layout's inline `THEME_SCRIPT` applies them before the first paint and is kept in step with
`appearance.ts`; it writes the stored palette name unchecked, so an unknown one shows the
base colours until the controller puts the default in its place on load. Those two keys predate the shared settings contract and do not yet follow it
(`<app>.<record>.v<N>`, a `settings-contract` test): renaming them is a migration of its
own, not part of the merge that brought them here. Each control is its own reset, and
nothing about one is destructive, so nothing is confirmed. The About section on each
app's `/settings` takes its version from that app's `package.json` through
`src/lib/version.ts` (imported, since `npm_package_version` is unset under `next start`
and in the Docker image), which `/api/health` reports too and `tests/version.test.ts`
pins.
