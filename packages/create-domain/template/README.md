# CollectCollect · __NAME__

Tracks __PLURAL__: what each one cost, what it is worth now, how that has moved, and where it is kept. Built on the shared engine in `packages/core`: portfolio value and change over 1W/1M/3M/1Y/all, a value-over-time chart, purchase lots with oldest-first cost basis, realised and unrealised gains, price alerts with a webhook, storage locations, a printable insurance report, CSV import and export, and a Markdown mirror of every item.

## What a __SINGULAR__ is here

See `src/lib/spec.ts`. The fields, which are searchable and filterable, and the identification schema all come from that one description.

## One specific object, or a stack?

TODO: state the rule. A __SINGULAR__ with a serial number is one specific object and is never merged; identical copies without one stack ("I own 3 of these").

## Price sources

TODO: a manual-entry source is registered; replace it with a real one. A price typed on an item overrides every source, and past values can be entered by hand so the chart works.

## Photo identification

Set `ANTHROPIC_API_KEY` and a photo of a __SINGULAR__ fills the form in; every field can still be corrected before saving.

## Running it

```sh
npm install
npm run dev -w @collectcollect/__ID__     # http://localhost:__PORT__
```

Environment variables (all optional): `__PREFIX___DATA_DIR` (default `./data`), `__PREFIX___APP_PASSWORD` and `__PREFIX___APP_SECRET` to require a login, `__PREFIX___AUTO_REFRESH_HOURS` (default 24, 0 disables), `MARKDOWN_MIRROR=off` for a read-only data volume, `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` for identification.

## Tests

```sh
npm test -w @collectcollect/__ID__
```

`tests/spec.test.ts` covers the schema, the one-object-or-a-stack rule and a
value entered by hand. Add a test per price provider against a fake `fetch`
(see `apps/retro-games/tests/pricecharting.test.ts`) as you wire real ones up.

The pages this app renders come from the shared engine, and they are driven end
to end by `apps/whisky`, so the portfolio, the collection page, an item, the
report, adding by hand, importing a spreadsheet and the password gate are
already covered. Write an end-to-end suite of your own only for what this app
adds on top of them.

## Known gaps

TODO.
