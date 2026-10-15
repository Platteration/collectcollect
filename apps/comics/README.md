# CollectCollect · Comics

Tracks a comic collection: single issues, raw or in a CGC, CBCS or PGX case. For every issue it knows what you paid, what a copy like yours is worth now and at every grade, how that has moved, and whether a raw key is worth sending in.

Built on the shared engine in `packages/core`: portfolio value and change over 1W/1M/3M/1Y/all, the value-over-time chart, purchase lots with oldest-first cost basis, realised and unrealised gains, price alerts with a webhook, storage locations, the printable insurance report, CSV import and export, backup and restore, and a Markdown mirror of every item.

## What a comic is here

`src/lib/spec.ts` is the whole description. The fields:

| Field | Type | Notes |
| --- | --- | --- |
| Title / series | text, required | searched |
| Publisher | text | searched; the portfolio splits value by it |
| Issue | text, required | as printed: `300`, `Annual 1`; searched |
| Volume | integer | |
| Cover date | text | `1988-05`, `May 1988`, `5/1988` or a year; normalised to `YYYY-MM` |
| Variant | text | cover letter, printing, newsstand, facsimile; searched |
| Key issue | multi-select | first appearance, origin, death, first issue, last issue, cameo, first cover, first team, new costume, wedding, classic cover, movie/TV tie-in |
| Of whom / what | text | "Venom", "Wolverine"; searched |
| In a slab | boolean | filtered |
| Grading company | enum | CGC, CBCS, PGX; slabs only; filtered |
| Grade | text | the slab's grade, or your own estimate for a raw copy; must carry a number on the 10-point scale |
| Cert number | text | slabs only |
| Page quality | enum | white, off-white to white, off-white, cream to off-white, cream, tan, brittle |
| Signature series | boolean | a witnessed signature (CGC SS, CBCS VS); filtered |
| Notes, location, photos, quantity, purchase price | | shared by every app |

Saving a raw copy clears the company and cert; saving a slab insists on both the company and the grade.

## One specific object, or a stack?

- **Slabbed** copies are unique: the cert number names one object. Two slabs are always two rows, and a second copy cannot be added to a slab's stack.
- **Raw** copies are fungible: a new copy joins an existing row when title, publisher, issue, volume, variant, estimated grade and signature status agree. "I own three raw X-Men #1 in 9.4" is one row with a quantity of three and three purchase lots behind it. A copy at a different estimated grade, a newsstand copy, or a signed copy is a separate row.

## Price sources

- **PriceCharting** (`PRICECHARTING_TOKEN`, paid API), through the client shared with the card and game apps. Its comic columns are read as grades: `loose-price` → raw, `cib-price` → Grade 4.0, `new-price` → 6.0, `graded-price` → 8.0, `box-only-price` → 9.0, `manual-only-price` → 9.2, `bgs-10-price` → 9.4, `condition-17-price` → 9.6, `condition-18-price` → 9.8. **This mapping was written from memory of PriceCharting's documentation with no network access and has not been checked against a live response**; if a column turns out to mean a different grade, fix `COMIC_FIELDS` in `src/lib/pricing/pricecharting.ts`. The search sends the series and issue number, insists the product's issue number agrees, and marks down bracketed editions (facsimile, newsstand) unless the copy says it is one.
- A slabbed copy reads the price at its grade (a CGC 9.4 reads Grade 9.4). For a grade PriceCharting has no sale at, the raw price is multiplied by the per-grade table under Settings (9.8 × 3, 9.6 × 2, … editable). A raw copy reads the raw price scaled down by the lowest bucket at or below its estimated grade (9.0 and up × 1, 8.0 × 0.8, 6.0 × 0.5, 4.0 × 0.35 …). A witnessed signature multiplies the result (× 1.25 by default).
- **Your own price**: a value typed on a comic overrides every source, and one typed under a grade key overrides PriceCharting for that grade. Past values can be entered by hand with a date so the chart works without any source.
- TODO: an eBay sold-listings aggregation by grade would cover what PriceCharting does not (grades between its columns, variants it does not list, and the raw market by grade). The provider interface takes any number of sources; a new one is a `PriceProvider<ComicQuery>` registered in the spec.

Auto-refresh re-prices anything older than `COMICS_AUTO_REFRESH_HOURS` (default 24) once an hour.

## Grade it, or wait?

The grade / wait / skip verdict from the card app runs on every raw copy: the best outcome is the 9.8 price, the low outcome the 8.0 price, and the copy's own raw value is what it is worth today; the outlook also prices the slab at the grade you expect it to get. Settings hold the grading fee (default $60) and what "ready to grade" needs ($75 of upside after the fee and 40% of the raw value by default). A **Grading window** alert is raised the first time a copy clears them.

## Certificate verification

Every slab's page has a "Check with the grading company" button behind `POST /api/items/:id/verify-cert`. The verifier (`src/lib/cert.ts`) implements the interface the engine defines, `(item) → match | mismatch | unknown`, and today does the part that needs no network: it answers **mismatch** when the number cannot be the company's (CGC numbers read like `1234567-001`, CBCS like `19-1A2B3C4D-001`, PGX are digits) and **unknown** with a link to the company's own lookup page otherwise. **TODO:** a live lookup against CGC's and CBCS's registers, comparing title, issue and grade, once there is a sanctioned way to query them; neither publishes an API.

## Photo identification

With `ANTHROPIC_API_KEY` set, one to four photos of a cover, an indicia page or a slab label go to Claude vision, which returns every field above plus a confidence, plausible alternatives and a search query, in the schema's own vocabulary (`src/lib/identify.ts`). It is told to read the indicia, to treat a facsimile as a different issue, to name key issues only when sure, and to estimate a raw grade honestly or not at all. Everything is reviewed in the form before anything is saved.

## Running it

```sh
npm install
npm run comics                 # http://localhost:3003
```

Or from a container: `docker build --build-arg APP=comics -t collectcollect-comics .` and `docker compose up comics`.

Environment variables, all optional: `COMICS_DATA_DIR` (default `./data`, resolved from this folder), `COMICS_APP_PASSWORD` and `COMICS_APP_SECRET` for a login, `COMICS_AUTO_REFRESH_HOURS`, `PRICECHARTING_TOKEN`, `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`, `MARKDOWN_MIRROR=off` for a read-only data volume.

An empty portfolio offers **Load sample data**: nine believable issues, three of them slabbed, one a signature series, with purchases and eighteen months of history.

Every comic is mirrored to `data/collection/comics/<id>-<title>.md` with its record in the front matter and its values, purchases and sales as tables; `index.md` lists the collection with publisher and key-issue columns.

## Tests

```sh
npm test -w @collectcollect/comics
```

- `tests/spec.test.ts`: schema validation, cover-date normalisation, key flags, slab rules, CSV aliases, the unique-vs-stackable rule, identification mapping, the Markdown mirror and the seed.
- `tests/cert.test.ts`: the verifier's three answers.
- `tests/pricecharting.test.ts`: the search string, ranking by issue number and edition, the column mapping, id lookup and errors, against a fake `fetch`.
- `tests/summary.test.ts`: raw and slabbed valuation, estimates, the signature premium, manual overrides, the outlook and the grading-window alert.

## Known gaps

- The PriceCharting column-to-grade mapping is unverified (see above).
- No live certificate lookup; the verifier checks the number's shape only.
- No eBay or auction-house source; a raw key's market between PriceCharting's grade columns is estimated by multiplier.
- No end-to-end suite of its own. The pages this app renders come from the shared engine and are covered end to end by `apps/whisky`, which drives a real build through the portfolio, the collection, an item, the report, adding by hand, importing a spreadsheet and the password gate. What is not covered there is the key-issue line and the certificate check, which unit tests reach but a browser does not.
