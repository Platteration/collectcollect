# CollectCollect · Whisky

Tracks a whisky collection: what each bottle cost, what the sealed ones are worth and how that has moved, and the open ones kept for drinking without losing what they were worth the day they were opened.

Built on the shared engine in `packages/core`: portfolio value and change over 1W/1M/3M/1Y/all, the value-over-time chart, purchase lots with oldest-first cost basis, realised and unrealised gains, price alerts with a webhook, storage locations, the printable report, CSV import and export, backup and restore, and a Markdown mirror of every item.

## What a bottle is here

`src/lib/spec.ts` is the whole description. The fields:

| Field | Type | Notes |
| --- | --- | --- |
| Distillery / brand | text, required | searched |
| Expression | text, required | searched |
| Age statement | integer, years | empty for a no-age-statement bottling |
| Vintage | integer | distillation year |
| Bottling year | integer | |
| Cask type | text | searched |
| ABV | number, % | |
| Bottle size | integer, ml | default 700 |
| Bottle / batch number | text | a bottle number (`Bottle 123 of 2000`) names one bottle; a batch is shared by a run |
| Region / country | enum | Speyside, Highland, Islay, Lowland, Campbeltown, Islands, blends, Ireland, USA, Japan, Taiwan, India, Canada, Australia, other; filtered; the portfolio splits value by it |
| Packaging | enum | tube, box, none; filtered |
| Sealed | boolean | filtered; unticking it opens the bottle (see below) |
| Fill level | integer, % | open bottles only |
| Opened on, value when opened | | set by the app when a bottle is opened; read-only |
| Notes, location, photos, quantity, purchase price | | shared by every app |

## Sealed, or open

**Sealed bottles are fungible.** A new bottle joins an existing row when distillery, expression, age, vintage, bottling year, cask, strength, size, batch and packaging agree: "I own three of these" is one row with a quantity of three and a purchase lot for each buy. A numbered bottle (`Bottle 123 of 2000`) is one specific object and never merges.

**An open bottle is one specific object.** The moment a bottle is opened:

- its investment value is **frozen** at what it was worth that day (your own price if you set one, else the latest recorded value), and stays there whatever you enter afterwards;
- it is **left out of the portfolio total** and the chart, but stays in the collection, on its own page, on the report (listed at the frozen value, marked not counted) and in the Markdown mirror;
- it becomes a row of its own with a fill level, an opened-on date and a quantity of one.

There are two ways to open one. **Open a bottle** on a sealed bottle's page takes one copy off the stack: the copy leaves at the cost of the oldest copy still held (the same oldest-first rule a sale uses), the stack's quantity and cost basis follow, and the new row starts its history at the value it took with it. Or untick **Sealed** in the edit form, which opens that row in place. Ticking it back thaws the value, for the bottle opened by mistake.

## Price sources

- **Manual entry** is the only source today. Type what a sealed bottle is worth on its page, and enter past values with dates (an auction hammer price, a retailer's price on a day) so the chart has a line. Refresh does nothing on its own and says so.
- **TODO:** an auction-house source. Whisky Auctioneer, Scotch Whisky Auctions and Whisky Hammer publish hammer prices per lot but no API; WhiskyBase keeps a market page per bottling. Any of them is a `PriceProvider<BottleQuery>` registered in `src/lib/spec.ts`; the query carries distillery, expression, age, vintage, bottling year and size, which is what those lots are keyed by.

Price-move alerts still fire when a value you enter moves by more than the threshold in Settings.

## Photo identification

With `ANTHROPIC_API_KEY` set, photos of the label, neck and packaging go to Claude vision, which returns distillery, expression, age, strength, size, vintage, bottling year (only from a lot code it can actually read), cask, bottle or batch number, region, packaging, whether the seal is intact and a fill estimate for an old or open bottle, with a confidence and alternatives. Everything is reviewed in the form before anything is saved.

## Running it

```sh
npm install
npm run whisky                 # http://localhost:3005
```

Or from a container: `docker build --build-arg APP=whisky -t collectcollect-whisky .` and `docker compose up whisky`.

Environment variables, all optional: `WHISKY_DATA_DIR` (default `./data`, resolved from this folder), `WHISKY_APP_PASSWORD` and `WHISKY_APP_SECRET` for a login, `WHISKY_AUTO_REFRESH_HOURS`, `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`, `MARKDOWN_MIRROR=off` for a read-only data volume.

An empty portfolio offers **Load sample data**: eight bottlings, two of them stacks, two of them open, with purchases and eighteen months of history.

Every bottle is mirrored to `data/collection/bottles/<id>-<distillery-expression>.md` with its record in the front matter and, for an open bottle, a section saying when it was opened and what it was frozen at; `index.md` lists the collection with region and age columns.

## API

Everything the shared engine provides, plus `POST /api/items/:id/open` with an optional `{ "fillLevel": 95, "at": "2026-02-02" }` body: opens one copy and answers with the opened bottle.

## Tests

```sh
npm test -w @collectcollect/whisky
```

- `tests/spec.test.ts`: schema validation and defaults, bottle number versus batch, CSV aliases, the stack-or-object rules, identification mapping, the mirror and the seed.
- `tests/open.test.ts`: opening one copy off a stack (cost from the oldest lot, frozen value, history carried over, lot invariant), opening the only copy in place, the freeze-and-thaw hook on an ordinary edit, a bottle opened before it was valued, and what stays in the collection and out of the total.
- `tests/pricing.test.ts`: the manual-only source and hand-entered history.

## Known gaps

- No auction or market price source; values are what you enter.
- Drinking a bottle down does not change its frozen value, by design; a partly drunk bottle's resale value is not modelled.
- No e2e suite; the shared pages are covered by unit tests and a smoke run of the built app.
