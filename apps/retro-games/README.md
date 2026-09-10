# CollectCollect · Retro games

Tracks a retro game collection: cartridges and discs from the Atari 2600 to the Wii U, loose, complete in box, sealed, or in a WATA, VGA or CGC case. For every game it knows what you paid, what a copy like yours is worth now, how that has moved, and whether a sealed or complete copy is worth sending to be graded.

Built on the shared engine in `packages/core`, which provides everything that is the same whatever you collect: portfolio value and change over 1W/1M/3M/1Y/all, the value-over-time chart, purchase lots with oldest-first cost basis, realised and unrealised gains, price alerts with a webhook, storage locations, the printable insurance report, CSV import and export, backup and restore, and a Markdown mirror of every item.

## What a game is here

`src/lib/spec.ts` is the whole description. The fields:

| Field | Type | Notes |
| --- | --- | --- |
| Title | text, required | searched |
| Platform | enum, required | NES through Wii U, Sega, Sony, Microsoft, Atari, Neo Geo, TurboGrafx, 3DO, PC; searched and filtered |
| Region | enum | NTSC-U (default), PAL, NTSC-J, other; filtered |
| Release year | integer | |
| Publisher | text | searched |
| Completeness | enum | loose, complete in box, sealed, graded; filtered |
| Grading company | enum | WATA, VGA, CGC; only for graded copies |
| Grade | text | as printed: `9.4 A+`, `85`, `9.6` |
| Cert number | text | |
| Box condition | enum | mint, near mint, very good, good, fair, poor; boxed, sealed and graded copies |
| Manual condition | enum | same scale; complete and graded copies |
| Cart / disc condition | enum | same scale; loose, complete and graded copies |
| Variant / revision | text | Player's Choice, Greatest Hits, Rev-A, a regional cover; searched |
| Notes, location, photos, quantity, purchase price | | shared by every app |

The form only shows the fields a completeness can have, and saving clears the rest: a loose cart has no box condition, a sealed game has no cartridge condition, and grading fields only exist inside a case. A graded copy has to say who graded it and what they said.

The condition scale is a single six-step scale for each component (box, manual, cartridge or disc). It maps to a multiplier on the tier price under Settings, where **very good is 1.0**, the condition PriceCharting's figures assume; mint is 1.15 and poor is 0.5 by default. A loose copy is scaled by its cartridge, a sealed copy by its box, and a complete copy by whichever of its parts is worst, since that is the grade it sells at.

## One specific object, or a stack?

- **Graded** copies are unique: the cert number names one object. Two slabs are always two rows, even with the same grade and cert typed in by mistake, and a second copy cannot be added to a slab's stack.
- **Loose, complete and sealed** copies are fungible: a new copy joins an existing row when title, platform, region, completeness, variant and every recorded condition agree. "I own three CIB copies of Sonic 2 in good shape" is one row with a quantity of three and three purchase lots behind it. A copy in worse condition, a PAL copy, or a sealed copy of a game held boxed is a separate row.

## Price sources

- **PriceCharting** (`PRICECHARTING_TOKEN`, paid API), through the client shared with the card app. Its price fields are read as: `loose-price` → Loose, `cib-price` → CIB, `new-price` → New (sealed), `graded-price` → Graded, plus box-only and manual-only. A copy reads the price of its own completeness, scaled by its condition; a graded copy reads the graded price, which is PriceCharting's blended figure for graded copies and does not distinguish a 9.4 from a 9.8. When there is no graded sale, a graded price is estimated from the raw tier with the multipliers under Settings (a sealed copy × 2.0, a complete one × 1.4 by default). The search sends the console name the way PriceCharting files it, with `PAL` and `JP` prefixes (a Japanese SNES game is looked up as Super Famicom), and a listing in the wrong region scores below one in the right platform. Once a listing has matched it is fetched by id on later refreshes, so a common title cannot drift between listings. The console names were written from memory, not checked against the live API, and a platform that fails to match will show up as "no price"; the scorer tolerates small naming differences.
- **Your own price**: a value typed on a game overrides every source, and a value typed under Loose, CIB, New or Graded overrides PriceCharting for that key. Past values can be entered by hand with a date, so a game bought at auction has a chart even before PriceCharting is configured.

Auto-refresh re-prices anything older than `RETRO_GAMES_AUTO_REFRESH_HOURS` (default 24) once an hour.

## Grade it, or wait?

The grade / wait / skip verdict from the card app runs on every sealed or complete copy, with the graded price (real or estimated) as the best outcome and the copy's own tier price as raw. Settings hold the grading fee (default $100 all in), and what "ready to grade" needs: at least $100 of upside after the fee and at least 30% of the raw value. When a copy first clears those thresholds while the gap is at its widest, a **Grading window** alert is raised (and POSTed to the webhook, if set).

## Photo identification

With `ANTHROPIC_API_KEY` set, one to four photos of a cartridge, disc, box, manual or slab label go to Claude vision, which returns every field above plus a confidence, plausible alternatives and a search query, in the schema's own vocabulary (`src/lib/identify.ts`). The prompt is told that completeness is what matters most and to say "sealed" only when a seal is actually visible. Everything it says is reviewed in the form before anything is saved. Without a key, the form works by hand.

## Running it

```sh
npm install
npm run retro-games            # http://localhost:3002
```

Or from a container: `docker build --build-arg APP=retro-games -t collectcollect-retro-games .` and `docker compose up retro-games`.

Environment variables, all optional: `RETRO_GAMES_DATA_DIR` (default `./data`, resolved from this folder), `RETRO_GAMES_APP_PASSWORD` and `RETRO_GAMES_APP_SECRET` for a login, `RETRO_GAMES_AUTO_REFRESH_HOURS`, `PRICECHARTING_TOKEN`, `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`, `MARKDOWN_MIRROR=off` for a read-only data volume.

An empty portfolio offers **Load sample data**: ten believable games with purchases and eighteen months of history, so every page has something on it. It refuses once anything is held.

Every game is mirrored to `data/collection/games/<id>-<title>.md` with its record in the front matter and its values, purchases and sales as tables; `index.md` lists the collection with platform and region columns. The folder is what survives the app: it can be rebuilt from the database, and the database from it.

## Tests

```sh
npm test -w @collectcollect/retro-games
```

- `tests/spec.test.ts`: schema validation, defaults, cross-field rules, CSV aliases, the unique-vs-stackable rule, identification mapping, the Markdown mirror and the seed.
- `tests/pricecharting.test.ts`: the search string per platform and region, ranking, the price-field mapping, id lookup and search fallback, error handling, all against a fake `fetch`.
- `tests/summary.test.ts`: what a copy is worth by completeness and condition, graded and estimated prices, manual overrides, the grade-or-wait outlook and the grading-window alert.

## Known gaps

- PriceCharting's graded price is one number per game; a WATA 9.8 and a 9.0 read the same figure. There is no per-grade source for games.
- Console names for PriceCharting are unverified against the live API (no network access while this was written). If a platform never matches, fix its name in `priceChartingConsole` in `src/lib/types.ts`.
- No certificate verification for WATA, VGA or CGC. The cert number is stored and printed on the report only.
- No e2e suite; the shared pages are covered by unit tests and a smoke run of the built app.
