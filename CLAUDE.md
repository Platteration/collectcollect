@AGENTS.md

## Layout

An npm workspace: `apps/cards` (the trading-card app), `apps/skins` (the same engine for
CS2 items), four apps on the domain engine (`apps/retro-games`, `apps/comics`,
`apps/watches`, `apps/whisky`) and two packages. `packages/core` is code with no opinion
about what is collected: the proxy and its security headers, the gate — a password, sign-in
with Google, or both — and sessions, forwarded-header trust, body limits, restore
validation, zip, CSV, charts, and the domain engine (below). `packages/create-domain`
scaffolds a new app on that engine: `node packages/create-domain/index.mjs <id> …` copies
`template/` into `apps/<id>` with the app's names filled in, and its `test` script runs the
template's own tests. Each app is a Next.js app, and `next dev` writes an
`AGENTS.md`/`CLAUDE.md` into it, which are committed as it makes them (cards and skins
have theirs; the four domain apps have none until it has run in them).
`next` itself is declared once, in the root `package.json`, so all six apps and the shared
package run the same version; `CONTRIBUTING.md` has what goes where.

## The domain engine

`packages/core/src/domain`, `src/pages` and `src/components/domain` are one engine that
four apps share, and that cards and skins do not use: they keep their own repositories and
reach core only for what has no opinion (the proxy, the gate, zip, CSV, charts, the
shell). An app on it is a `DomainSpec` (`domain/spec.ts`): typed fields, the rule for
whether a row is one object or a stack, price providers, an identification prompt,
settings, alerts, the report layout. `createEngine(spec)` (`domain/engine.ts`) builds from
it the repository, the purchase-lot ledger, sales, pricing and its scheduler, the Markdown
mirror, backup and restore, CSV import and export, identification, and the auth; each
app's `src/lib/engine.ts` is that one call, `src/lib/routes.ts` is `createRoutes(engine)`,
every `route.ts` re-exports one handler from it, and its pages render `PortfolioPage`,
`CollectionPage`, `ItemPage` and the rest from `packages/core/src/pages` with the app's
small hooks, inside `AppShell`. `spec.envPrefix` names the app's variables:
`<PREFIX>_APP_PASSWORD`, `_APP_SECRET`, `_DATA_DIR`, `_DATABASE_FILE`,
`_AUTO_REFRESH_HOURS`. The database is `collectcollect-<id>.db` and the session cookie
`cc_<id>_session` (non-alphanumerics in the id become `_`), per `domainAuth` in
`domain/auth.ts`, which the app's `src/proxy.ts` builds without importing the engine, so
the proxy bundle carries no database.

What the domain apps do not have: sign-in with Google (`domainAuth` is a password and
nothing else), a record of ended sessions (`createAuthRoutes` is given no `sessions`, so
signing out clears that browser's cookie and *Sign out everywhere* does not exist; a copy of
the cookie stays good for 30 days, and changing the password or `<PREFIX>_APP_SECRET`
ends them all), and a signing key kept beside the data (with no `<PREFIX>_APP_SECRET`
the key is derived from the password, and the log says so once). The engine's CSV import
has no `MAX_IMPORT_ROWS`, and no `linear-parsing` test holds its parsers.

Type checking is in two steps because the engine came from a branch written before
`packages/core/tsconfig.json` required `noUncheckedIndexedAccess`. `tsconfig.json` is the
strict one and **excludes** `src/domain`, `src/pages`, `src/components/domain`,
`src/components/OutlookChart.tsx`, `src/grading.ts` and `src/pricing` (the engine's copies
of the card app's outlook chart, grading verdict and PriceCharting client);
`tsconfig.domain.json` extends it with only that flag off and covers those, `tests/**` and
`vitest.config.ts`; `typecheck` runs it as the third step. A new core file goes under
`tsconfig.json` if it passes the flag, otherwise in `tsconfig.domain.json`'s `include`
and `tsconfig.json`'s `exclude`, so that `npm run typecheck` reaches it (the conventions
test checks that every source is reached). The four apps' `tsconfig.json` and the
template's have the flag off for the same reason. This is a stopgap and not a setting: the
conventions test's `noUncheckedIndexedAccess in every TypeScript project` fails for as
long as any project has it off, and when the engine passes it `tsconfig.domain.json`, its
typecheck step, the exclude list and the apps' overrides go.

Tests: `packages/core/tests` (vitest: repository, routes, pricing, analytics, CSV,
Markdown, `AppShell`) and each app's `tests` (its spec, its merge rule, its price adapter
against a fake `fetch`). The Playwright suites are retro-games', comics' and whisky's (a
read, a write and a locked server each, ports 3240–3242, 3250–3252 and 3230–3232);
watches has none. They import `test` from `@playwright/test`, not `e2e/fixtures.ts`.

## Sign in with Google

The fleet's sign-in kit lives at `packages/core/src/kit/`, not `server/kit/`: the apps reach
it only through `packages/core`, which Next transpiles and bundles into each app and the
Docker image. Its bytes are the canonical copy's, its `.d.ts` files included (`diff -r`
against it is empty, and the conventions test holds it to the canonical copy's hash,
`KIT_SHA`), and are never edited here: a change is asked of the canonical copy and copied in
whole. This repository uses three of its modules, `google.js`, `crypto.js` and `http.js`,
from `packages/core/src/google-signin.ts`; the rest (its configuration reader `config.js`,
its own sessions, users, Stripe, the adapters) is carried unused, since there is no shop and
no webhook here, so a change to those modules changes the bytes here and nothing the apps
do. `npm test` runs its self-test first (`packages/core`'s `test` script is
`node --test src/kit/selftest.mjs && vitest run`: the kit's self-test, then core's own
suites), and `packages/core`'s `typecheck` runs three configurations: its declarations are
checked with the package's own `tsconfig.json`, its JavaScript with `tsconfig.kit.json`
(the same options plus `checkJs` and Node's types), and the domain engine with
`tsconfig.domain.json` (above); its `eslint .` lints all nineteen files.

Sign-in with Google is a way past the gate of cards and skins (the four domain apps have
the password alone), beside the password or in its place, for
the accounts the app lists: `google-config.ts` reads the app's variables (`APP_URL` and
`GOOGLE_*` for cards, `SKINS_APP_URL` and `SKINS_GOOGLE_*` for skins, by `googleVariables`
in each app's `src/lib/auth.ts`), and `google-signin.ts` is the start and callback routes.
An allowed account gets the app's own session cookie (`cc_session`, `cc_skins_session`),
the one the password gives, so revocation, *Sign out everywhere* and the proxy need nothing
new; the state between leaving for Google and coming back is a signed
`__Host-collectcollect-<app>-oauth` cookie. The rules that hold it: any `GOOGLE_` variable
turns the gate on, and a configuration that does not hold (an empty list included) lets
nobody in rather than opening the app; that cookie is signed with a random key made once
per process (`flowKey` in `auth.ts`, kept on `globalThis` so any second copy of the module
in the process shares it), never the session key, because the start route answers
anyone and a MAC of known text under the session key was an offline oracle for it; with
no password, sessions are signed with the seed or an `APP_SECRET` of at least
`MIN_SECRET_BYTES`, never a key derived from nothing; a session is bound to the list, so
changing it ends every session, and a gate with no Google variables signs exactly what it
signed before. An account let in by its address alone is named by id in the log, once: an
address is Google's say-so for itself only at gmail.com and in a Workspace domain, and the
kit's identity does not carry `hd`, so README tells the owner to prefer ids.
`apps/cards/tests/google-signin.test.ts` drives the routes against the fake Google in
`scripts/fake-google.mjs`, handed in through `createAuthRoutes({ fetch })`; the
browser suites' Google servers (cards' locked server, skins' `google` project on 3223) get
the same fake through `scripts/e2e-google.mjs`, and the specs answer Google's sign-in page
at the protocol (`googleSignsIn`): Playwright passes a redirected request to the network
whatever `page.route` says, and the start route reaches Google by a redirect.

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
would: `createProxy` in `packages/core/src/proxy.ts` runs for every path (cards' and
skins' `matcher` leaves out only the dev server's hot-reload socket) and sets every security
header per request, Next's `/_next/` files, the not-found page and every refusal
included; `next.config.ts` sets none, since a header frozen into the build could only
contradict it. The values of cards and skins are written out once more, in the README's
two machine-read blocks (`<!-- headers:cards:begin -->`, `headers:skins`): each of those
apps' `tests/website.test.ts` holds the proxy's output equal to its block word for word,
and `e2e/website.spec.ts` holds every live response to it. Change one, change both. An
address with a trailing slash is redirected by the proxy (cards' and skins'
`next.config.ts` set `skipTrailingSlashRedirect`, since Next's own redirect runs before
the proxy and carried no header); Next's repeated-slash redirect and its 500 for `TRACE`, and Node's own 400
for an unknown method and 431 for oversized headers, still leave without them, and
`website.spec.ts` pins all four, so the README's sentence about them changes when Next or
Node does. What only https may carry — HSTS, `upgrade-insecure-requests`, an https
`Origin` on a write — is decided per request by `servedOverHttps` in
`packages/core/src/net.ts`: a trusted proxy's `X-Forwarded-Proto`, or a request sent to
the https address `APP_BASE_URL` names. Never the request URL's scheme, which Next writes
from any client's `X-Forwarded-Proto`, and never for the whole deployment: a LAN name
listed beside the domain is plain http, and the cards suite's locked server is set up
that way (`auth.spec.ts` drives it through a `.lan` name). The four domain apps run the same
`createProxy` (the host list, the cross-site and JSON rules, the headers, the password
gate; their `src/proxy.ts` names `/login` and `/api/auth` as public paths and nothing
else) but are not held to the rest of this section: no README block, no
`tests/website.test.ts`, no `e2e/website.spec.ts`, no `e2e/fixtures.ts`; no `public/`
folder, so no `robots.txt` or `security.txt`; a `matcher` that
leaves out `/_next/static`, `/_next/image` and `/favicon.ico`, so those answers carry no
header; no `skipTrailingSlashRedirect`, so Next's trailing-slash redirect leaves without
them; and a `next.config.ts` with neither `poweredByHeader: false` nor
`experimental.proxyClientMaxBodySize`, so they send `X-Powered-By` and Next cuts a request
body past its default 10 MB short (`packages/core/src/limits.ts` says why that matters).
Every source in the policy
was measured in Chromium against the production build, by taking it out and seeing a spec
go red (but `script-src`'s `'self'`, a fallback
Chromium ignores beside `'strict-dynamic'`, and `worker-src`, which it fills from
`script-src`: README, "The website"); add one only when a spec shows something real
needs it. Every cards and skins spec imports `test` from `e2e/fixtures.ts`, not
`@playwright/test` (`tests/website.test.ts` fails on one that does not), so every page any
test drives, in a context the test makes for itself too, fails on a policy violation, an
uncaught exception or a request that leaves the site (but one: the top-level navigation to
Google's sign-in page, which the test answers itself); `unwatchedContext` is for a test
whose pages break those rules on purpose. Cards' and skins' `website.spec.ts` starts every
page the app has, read off `src/app`: a new page fails it until the walk has an address for
it. In skins an item's picture is drawn only from the hosts `IMAGE_SOURCES` names
(`src/lib/images.ts`), which is also the policy's `img-src`, so a host added to one is in
the other; in cards an outside picture is drawn only over https (`shownImage` in
`src/lib/format.ts`), which is what its `img-src` allows. `public/` is served whole, so it
holds only what a page loads: a source such as the skins icon's SVG lives beside the
script that uses it. API answers are `no-store` unless their path is on the app's
`cachedPaths` (the proxy's header wins over a route's own). Without a session, only each app's
`publicPaths` and the proxy's `SITE_PATHS` answer (`/_next/static`, `/robots.txt`,
`/.well-known/security.txt`, `/guard.js`). `/guard.js` is the safety net
(`packages/core/src/guard.ts`, loaded with the nonce, before the app; `Started` tells it
the page started, `NoScriptNote` covers no JavaScript at all); cards and skins load it,
and the domain apps' `AppShell` loads none of the three. Cards' and skins'
`public/.well-known/security.txt` expires on 2027-10-08 and the unit test fails once it
has. Each app lives at the root of
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
kilobytes of crafted text, and the `linear-parsing` tests in cards and skins hold each reader
they replaced to a budget on such input, and to reading exactly what its pattern read on
seeded short inputs drawn from the characters that matter (brackets, every line break).
A stored row is read back field by field rather than trusted for its shape
(`readPriceSummary`, `decode` in `scan-drafts.ts`, `readStored` and the JSON-column
readers beside it in `cards.ts`): a restore installs rows this app never wrote, and a
reader that indexes into one it cannot read takes every page that lists
it down. An import reads at most `MAX_IMPORT_ROWS` rows in cards and skins; the domain
engine's does not cap them, and no `linear-parsing` test holds its parsers.

## Settings

Each app keeps its settings server-side: one JSON record under the `settings` key of its
SQLite `settings` table, read and sanitised by `getSettings()`/`saveSettings()` in
`apps/cards/src/lib/settings.ts` and `apps/skins/src/lib/settings.ts` (the domain apps':
`createSettings` in `packages/core/src/domain/settings.ts`) and edited on
`/settings`. Two preferences live in the browser instead, shared by all six apps through
`packages/core`: the theme (localStorage `theme`: `system`, `light` or `dark`; `system`
follows `prefers-color-scheme`) and the palette (localStorage `colorScheme`, one of
`COLOR_SCHEMES` in `packages/core/src/color-schemes.ts`, whose grounds, panels and accents
are `packages/core/src/family-theme.css`). One controller, `packages/core/src/appearance.ts`,
reads, stores and applies both for `ThemeToggle` (the header's switch and palette menu) and
`ColorSchemePicker` (Settings), keeps a choice the browser will not store in memory with a
note, and keeps tabs in step. It reads both by literal comparison against the known ids, so
a stored value that names something on `Object.prototype` reads as the default. Each
layout's inline `THEME_SCRIPT` (the domain apps' is `AppShell`'s, stamped with the proxy's
nonce) applies them before the first paint and is kept in step with
`appearance.ts`; it writes the stored palette name unchecked, so an unknown one shows the
base colours until the controller puts the default in its place on load. Those two keys predate the shared settings contract and do not yet follow it
(`<app>.<record>.v<N>`, a `settings-contract` test): renaming them is a migration of its
own, not part of the merge that brought them here. Each control is its own reset, and
nothing about one is destructive, so nothing is confirmed. The About section on
cards' and skins' `/settings` takes its version from that app's `package.json` through
`src/lib/version.ts` (imported, since `npm_package_version` is unset under `next start`
and in the Docker image), which `/api/health` reports too and `tests/version.test.ts`
pins; the domain apps have no About section and no `version.ts`.
