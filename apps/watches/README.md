# CollectCollect · Watches

Tracks a watch collection: what each watch cost, what it is worth now and how that has moved, when it was serviced and by whom, and a printable appraisal an insurer will accept, with reference numbers, serial numbers (opt-in) and photos.

Built on the shared engine in `packages/core`: portfolio value and change over 1W/1M/3M/1Y/all, the value-over-time chart, purchase lots with oldest-first cost basis, realised and unrealised gains, price alerts with a webhook, storage locations, the printable report, CSV import and export, backup and restore, and a Markdown mirror of every item.

## What a watch is here

`src/lib/spec.ts` is the whole description. The fields:

| Field | Type | Notes |
| --- | --- | --- |
| Brand | text, required | searched |
| Model | text, required | searched |
| Reference number | text | searched |
| Serial number | text, **private** | see below |
| Movement | enum | automatic, manual wind, quartz; filtered |
| Calibre | text | searched |
| Case size | number | millimetres |
| Case material | enum | steel, yellow/rose/white gold, platinum, titanium, ceramic, bronze, two-tone, resin, other; filtered; the portfolio splits value by it |
| Dial | text | searched |
| Bracelet / strap | text | |
| Year | integer | |
| Box & papers | enum | both, box only, papers only, neither; filtered |
| Condition | enum | new / unworn, excellent, good, fair; filtered |
| Service history | list of date + notes | edited on the watch's page, not in the form |
| Notes, location, photos, purchase price | | shared by every app |

**Privacy.** The serial number is stored in the database and shown on the watch's own page, but it is left out of the Markdown mirror, the CSV export and the appraisal report unless you ask: Settings → *Write private fields to the plain-text copy and exports* covers the files, and the report has its own *Include private details* switch so a printed copy for an insurer carries serials while the one you email a buyer does not.

## One specific object, always

Every watch is unique. Two of the same reference are two rows: a serial number, a service history and the marks on a clasp belong to one watch, not to a model. Nothing stacks, a second copy cannot be added to a watch, and a quantity above one is brought back to one.

## Service history

Each watch's page has a service log: date and what was done. Entries are added and removed there (`PATCH /api/items/:id` with the whole list), sorted by date, written to the Markdown copy as a table, and the latest date appears on the appraisal report. A spreadsheet can carry a log as `2021-03-04: Full service; 2024-01-10: Crystal replaced` in a `service` column.

## Price sources

- **Manual entry** is the only source today. Type what a watch is worth on its page (it overrides everything), and enter past values with dates so the chart has a line: an auction result, a dealer's offer, a Chrono24 median on a given day. Refresh does nothing on its own, and says so.
- **TODO:** a market source. Chrono24 has no public API and forbids scraping; WatchCharts sells API access; auction houses (Phillips, Christie's, Sotheby's, Loupe This) publish results that would each need an adapter. Any of them is a `PriceProvider<WatchQuery>` registered in `src/lib/spec.ts`; the query already carries the brand, model and reference number.

Price-move alerts still fire when a value you enter moves by more than the threshold in Settings.

## The appraisal report

`/report` is written for an insurer: every watch with its reference, movement and calibre, case, year, last service date, condition, box and papers, value and the date it was recorded, plus totals and what was paid. Two switches at the top add the **serial numbers** (private, off by default) and the **photos**. Settings hold the owner's name, the insurer and the policy number, which print under the title. Print to PDF from the browser.

## Photo identification

With `ANTHROPIC_API_KEY` set, photos of the dial, caseback, clasp or papers go to Claude vision, which returns brand, model, reference and serial (only when actually legible, never guessed), movement, calibre, case size and material, dial, bracelet, year, what came with it and its condition, with a confidence and alternatives. Everything is reviewed in the form before anything is saved.

## Running it

```sh
npm install
npm run watches                # http://localhost:3004
```

Or from a container: `docker build --build-arg APP=watches -t collectcollect-watches .` and `docker compose up watches`.

Environment variables, all optional: `WATCHES_DATA_DIR` (default `./data`, resolved from this folder), `WATCHES_APP_PASSWORD` and `WATCHES_APP_SECRET` for a login, `WATCHES_AUTO_REFRESH_HOURS`, `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`, `MARKDOWN_MIRROR=off` for a read-only data volume.

An empty portfolio offers **Load sample data**: eight watches with purchases, eighteen months of history and a couple of service logs.

Every watch is mirrored to `data/collection/watches/<id>-<brand-model>.md` with its record in the front matter, its service history as a table, and its values, purchases and sales; `index.md` lists the collection with reference and year columns.

## Tests

```sh
npm test -w @collectcollect/watches
```

- `tests/spec.test.ts`: schema validation, the private serial and hidden service log, service-history parsing, CSV aliases, the always-unique rule, editing the log, identification mapping, the mirror and exports with and without private fields, the seed.
- `tests/pricing.test.ts`: the manual-only source, valuation from an entered value, hand-entered history and the chart order, price-move alerts.

## Known gaps

- No market price source; values are what you enter.
- No end-to-end suite of its own. The pages this app renders come from the shared engine and are covered end to end by `apps/whisky`, which drives a real build through the portfolio, the collection, an item, the report, adding by hand, importing a spreadsheet and the password gate. What is not covered there is the service log, which unit tests reach but a browser does not.
