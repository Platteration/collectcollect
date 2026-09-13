# Contributing

This is one repository holding two apps and a shared package, all TypeScript,
all checked the same way. The whole of what a change is expected to pass is one
line, run from the root:

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run e2e
```

`npm run e2e` drives a real production build, so it needs the build before it.
The suites boot their own servers on fixed ports (3210–3211 for cards,
3220–3222 for skins) against throwaway data directories, and clean up after
themselves.

## What goes where

- `apps/cards` and `apps/skins` are separate apps that share nothing but
  `packages/core`. A change to one should not need the other to change; a
  change to `packages/core` should keep both suites green.
- `packages/core` holds only code with no opinion about what is being
  collected. If a helper needs to know whether it is looking at a card or a
  skin, it does not belong there.
- Each app's `src/lib` is its repository and rules; `src/app/api` is thin
  routes over it; `src/components` is the UI. Tests live in each app's `tests`
  (Vitest) and `e2e` (Playwright).

## How changes land

- One commit per coherent change, with a message that says what the app now
  does differently and why — not what the diff is. The history reads as a
  changelog.
- A change to behaviour comes with the test that would have caught its
  absence: a unit test where the mistake would be silent, an end-to-end test
  where the behaviour is a screen.
- Money and counts are the point of these apps. Anything that writes a
  quantity, a price or a lot must keep `verifyLotInvariant()` empty, and a
  test that touches them should say so.
- The type checker runs strict with `noUncheckedIndexedAccess`. Narrow an
  indexed read; do not assert it with `!`.
- `next dev` writes an `AGENTS.md` and `CLAUDE.md` into each app; they are
  committed, so leave them as it makes them.

## Conventions

- Two-space indentation, LF line endings, a final newline (`.editorconfig`).
  There is no formatter step; eslint is the arbiter, and `npm run lint` must
  be clean.
- Node 22 or later, as `.nvmrc` and `package.json` say; `.npmrc` makes npm
  refuse anything older.
- Nothing in the repository reaches the network during tests. Providers are
  exercised against recorded responses with `fetch` replaced.
