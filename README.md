# CollectCollect

A personal cataloging app for trading cards: Pokémon, Yu-Gi-Oh!, Magic: The Gathering, sports cards (baseball, basketball, football, hockey…) and anything else in a sleeve.

Snap a photo of a card and CollectCollect:

1. **Identifies it** with Claude's vision model: game, name, set, collector number, year, rarity, printing variant (holo, 1st edition, refractor, autograph…) and, if it's in a slab, the grading company, grade and cert number.
2. **Looks up the going rate** for an **ungraded (raw)** copy and for **graded** copies (PSA / BGS / CGC / SGC) from live price sources.
3. **Keeps it in your collection** with quantity, condition or grade, purchase price, notes and a price history, and totals up what your collection is worth.
4. **Shows your portfolio** the way a brokerage app would: one headline number for the whole collection (valued at the grade or condition you recorded for each copy), the change over 1W / 1M / 3M / 1Y / all time, a value-over-time chart you can scrub, your total return against what you paid, the split by game, and your top holdings. Each card page has its own value chart and return.
5. **Tells you when to grade.** Every ungraded card gets a min/max outlook: the band between a mid-grade outcome and a gem-mint outcome, plotted against what the raw copy is worth. When the gap above the raw line is at its widest and clears your grading fee, the card is flagged as a good time to grade; when it has narrowed, it says wait; when even a PSA 10 would not cover the fee, it says skip.

## Quick start

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY (and optional price-source keys)
npm run dev               # http://localhost:3000
```

Production: `npm run build && npm start`. Everything is stored locally in `apps/cards/data` (SQLite database, uploaded photos, and a Markdown copy of the collection); set `DATA_DIR` to move it.

> Upgrading from a version before the app moved into `apps/cards`? Your collection is still where it was. On start the app looks for a `data` folder above itself and uses the one it finds, saying so in the log. Move it to `apps/cards/data`, or set `DATA_DIR`, to settle it permanently.

Docker: `docker compose up --build` (reads `.env`, keeps data in a named volume at `/data`).

**Password.** Set `APP_PASSWORD` and the app asks for it once, then remembers the session for 30 days in a signed HttpOnly cookie. Leave it unset and there is no login at all, which is fine on a machine only you can reach. Failed attempts are rate limited, and changing the password invalidates existing sessions.

> Even with a password, this is a single-user app holding one shared collection. It is meant for your own machine or private network, not for running a service for other people.

## How pricing works

| Source | Games | Key | What it provides |
| --- | --- | --- | --- |
| [PriceCharting](https://www.pricecharting.com/api-documentation) | all | `PRICECHARTING_TOKEN` (paid) | Ungraded **and graded** prices (PSA 10, Grade 9/9.5, BGS 10, CGC 10, SGC 10) |
| [Pokémon TCG API](https://pokemontcg.io) | Pokémon | optional `POKEMONTCG_API_KEY` | TCGplayer market price per printing (normal / holo / reverse / 1st ed.), Cardmarket EUR |
| [Scryfall](https://scryfall.com/docs/api) | Magic | none | USD / EUR, foil and non-foil |
| [YGOPRODeck](https://ygoprodeck.com/api-guide/) | Yu-Gi-Oh! | none | TCGplayer, eBay, Cardmarket, per-set price |
| Manual entry | all | — | Your own ungraded / graded prices, which override everything else |

The first four also supply set checklists for completion tracking, except PriceCharting.

For each card the app shows:

- **Ungraded (raw NM)** market price and where it came from.
- **Graded copies**: real graded prices when a source has them (PriceCharting or your manual entry). Grades with no real data are shown as **estimates** (`est.`) computed as *ungraded price × multiplier*; the multipliers live in Settings and default to conservative round numbers, so tune them per your experience.
- **Your copy**: the value of the specific copy you own. A PSA 9 uses the PSA 9 / Grade 9 price; a raw Lightly Played copy uses the ungraded price × the LP condition multiplier.

Every refresh stores a snapshot, so a card's detail page shows how its price has moved and the portfolio chart fills in. A refresh that returns no price (source down, no source configured for that game, no match) is reported but never stored over a card's last known value.

**Keeping history flowing.** The server re-prices any card whose latest snapshot is older than `AUTO_REFRESH_HOURS` (default 24, set 0 to disable) once an hour while it is running, and the Portfolio page has a *Refresh all prices* button. The min/max curves need a few refreshes before the timing verdict says anything stronger than "not enough history yet".

**Condition from the photo.** Identification also reports centering, corners, edges and surface, plus a conservative-to-optimistic estimate of the 10-point grade a raw card would likely receive and a caveat naming what the photo could not show. That estimate seeds the card's raw condition when you save it, and prices a "likely outcome" line in the grading outlook. It is a first look, not a prediction of what a grader would return.

**Grading plans.** Each raw card carries a plan: undecided, plan to grade, at the grader, or keeping raw. A card is flagged **Ready** when the timing verdict is good and its upside after the fee clears the thresholds in Settings (default $40 and 50% of the raw price). The portfolio page counts ready cards, totals their upside, and lets you filter by plan; when a card comes back from the grader, edit it and enter the grade.

**Submissions.** `/submissions` groups raw cards into a grading batch. Adding a card captures what it is worth raw and what gem mint would fetch at that moment; marking the batch sent moves those cards to "at the grader"; entering the grades that came back applies each grade to its card, so it is valued as a graded copy from then on, and books the batch's net outcome (value returned less raw value in less fees). Per-card lines show which cards paid for themselves and which did not, which is the feedback that makes the timing verdict worth trusting.

**Scan mode.** `/scan` is for working through a binder or a stack. Shoot one card at a time with the camera, or drop in a batch of photos. Each shot runs through upload, identification and saving on its own, two at a time, and a card that matches something you already own is merged as an extra copy automatically. Anything the model was less than 80% sure of, or that matches more than one card you own, is set aside for review instead of being saved unattended.

**Duplicates.** Saving a card that matches one you already have (same game and name, with the same number or set) offers to add it as another copy instead.

**Grading outlook math.** *max* is the PSA 10 price (real if a source reports it, otherwise ungraded × the PSA 10 multiplier); *min* is the PSA 8 / Grade 8 price on the same basis, falling back to the raw price; *upside* is max − raw − grading fee (Settings). "Good time to grade" means today's upside is within 10% of the highest upside in the card's history and positive.

Sports cards have no free price API; without a PriceCharting token you can still enter prices manually.

**Sales.** Log a sale from a card's page: copies leave the collection, the cost basis is captured at sale time so later edits don't rewrite history, and the portfolio shows realized gains (proceeds less fees less cost) beside unrealized ones. A sale can be undone, which puts the copies back. Fully sold cards stay in the collection greyed out with a "Sold" badge so their history survives.

**Alerts.** Every price refresh checks whether anything is worth mentioning: a card crossing your ready-to-grade thresholds, a move bigger than the percentage set in Settings, or real graded sales appearing where the app previously had only a multiplier estimate. Alerts collect in `/alerts` with an unread count in the nav. Setting a webhook URL POSTs each alert as JSON so you can forward them to email, push or chat through a service you control; a failing webhook is logged and never breaks a refresh.

**Appraisal report.** `/report` is a printable valuation of everything you own, with photos, identifications, grades, per-copy and total values, and the source and date behind each price. Print to PDF from the browser. Set the owner name in Settings.

**Import.** `/import` reads a CSV, whether it is this app's own export or a spreadsheet from another collection tool. Columns are matched by name, so headers like “Card Name”, “Edition”, “Qty” or “Price Paid” usually need no editing, and game and condition names are understood in the forms people actually write them ("Yu-Gi-Oh!", "Lightly Played", "VG"). A preview shows the matched columns, which columns were ignored, and any row it could not use, before anything is written. Rows matching a card you already own merge into it rather than duplicating.

**Set completion.** `/sets` lists every set your collection touches. Fetch a set's published checklist and it shows how complete the set is, which cards are still missing, and which you already have. Ownership is matched on collector number however it is written ("4/102" against "4"), falling back to the card name. Checklists come from the same sources as the prices: the Pokémon TCG API, Scryfall for Magic, and YGOPRODeck for Yu-Gi-Oh!. Sports cards have no checklist source, and the page says so rather than offering a button that cannot work.

**Where a card is.** Each card can record where it is physically kept ("Binder 2, page 4", "Slab box"). The Collection page filters by location, including a "no location recorded" option for what still needs putting away, locations already in use are offered as you type, and several cards can be filed at once. The location is searchable, exported, imported, and printed on the appraisal report, which is what makes the report useful for actually locating an insured card.

**Bulk actions.** Tick several cards on the Collection page to refresh their prices, set a grading plan, add them to a draft submission, or delete them in one go.

**Backup and restore.** Settings offers a single zip holding a consistent copy of the database (taken through SQLite's own backup, so it is safe while the app is running) and every photo, and takes one back to restore it. A restore validates the whole archive and opens its database before touching anything, refuses names that would escape the data directory or files the app did not write, and moves the collection being replaced into a dated folder rather than deleting it, so restoring the wrong file can be undone by hand. It holds the archive in memory, so it is capped at 512 MB; a larger collection is restored by unpacking the zip into the data directory with the app stopped.

**What each copy cost.** Cards get bought more than once, rarely at the same price. Every purchase is recorded as its own lot — when, how many, what each one cost, and where from — so a second copy never overwrites what the first one cost. Adding a copy of a card you already own asks for that copy's price rather than just bumping a number. Selling takes the copies you have held longest first, and the gain is measured against what *those* copies cost, not against an average and not against the newest price. Undoing a sale puts the copies back in the lots they came from.

A cost that was never recorded stays unrecorded rather than becoming zero: a card out of a bulk lot or a childhood shoebox is counted separately and left out of the return, because pricing it at nothing would report it as pure profit. `purchase_price` is now the average across the copies you still hold, worked out from the lots. Editing the quantity directly is treated as a correction to the count, not a purchase — the copies it adds have no price attached, and the app says so.

Collections from before this existed get one lot per card from what was already known, and the same rule applies to Markdown files written by an older version.

**Your collection is also plain text.** Every card is written to a Markdown file under `data/collection/cards/`, rewritten whenever that card changes: front matter holding the record (name, set, number, grade, copies, what you paid, where it is kept) and, below it, the same card written for a person — its photo, your notes, every price the app has recorded, and any sales. `index.md` lists the whole collection in one table, `README.md` in that folder explains the format to whoever finds it.

This exists so the collection outlives the app. If CollectCollect is never updated again, or you would rather keep your catalogue somewhere else, the folder is already a complete, readable record that any text editor, spreadsheet, git repository or notes tool can open — no database, no export step, nothing to run. Settings has *Download the Markdown* for a zip of it, *Rewrite the files* to bring them up to date from the database, and *Rebuild from these files* to read a collection back in. Reading files back matches each file to the card it describes — by the id in the file, or, when that id belongs to something else, by the card itself — so importing the same folder twice changes nothing the second time, and a folder from somewhere else can only add to a collection, never overwrite a card it has nothing to do with. Rewriting never deletes: a file describing a card the database does not have is counted and left alone, since the likeliest reason for one is that the folder is the copy that survived. Writing is best-effort by design: a full or read-only disk degrades the plain-text copy and is reported in Settings, but never stops a card being saved. Set `MARKDOWN_MIRROR=off` to switch it off.

The files hold every purchase and every recorded price — including which purchase each sale drew from — but not the individual provider quotes behind each price. Photos stay in `data/uploads/`, which the card files link to, so keep the two together — the Markdown download is text only, while the full backup carries both.

The archive is written and read by a small built-in zip writer and reader rather than a dependency. Tests check the writer against the system `unzip` and Python's `zipfile`, read back archives made by the system `zip` in both stored and deflated form, and confirm that a corrupted payload, a doctored entry name, a path that escapes, an oversized expansion and a database that will not open are each refused with the collection left untouched.

**Export.** The Collection page has an *Export CSV* button (also `GET /api/export`) with every card, its grade or condition, purchase price, and latest ungraded / PSA 10 / your-copy prices.

## Card identification

Identification runs on Claude (`claude-opus-5` by default; override with `CLAUDE_MODEL`). Photos are downscaled server-side before being sent. The model returns a structured identification with a confidence score and alternative matches when the card is ambiguous; you can add a back or slab-label photo, give it a hint ("it's Japanese"), and re-identify. Without an Anthropic key the app still works for manual entry and pricing.

## Look and feel

Dark is a **wireline** theme: a near-black ground with the interface drawn in white hairlines, so almost nothing is filled. That leaves saturation to mean something, and the only colours that carry are the ones that should — green when the collection is up, red when it is down. The portfolio line takes that colour and its area is a gradient of it, fading out towards the baseline so the line stays the loudest mark. Light mode keeps the validated chart palette and reads as an ordinary document.

The theme follows your system by default; the switch in the header pins it to light or dark and remembers the choice. An inline script resolves the preference to a single `data-theme` attribute before the first paint, so there is no flash of the wrong theme, and both the CSS variables and Tailwind's `dark:` utilities key off that one attribute rather than duplicating the condition. Pinning a theme also updates the browser chrome colour, so a light page never sits under black chrome.

Chart colours are not chosen by eye. The categorical slots are checked with the dataviz palette validator against this exact surface and pass its lightness band, chroma floor, colourblind separation and contrast checks; lighter values that looked better sat outside the band and were rejected. The green and red are deliberately brighter than that band, because they are a status pair rather than a categorical one, and direction is always carried by an arrow and the sign of the number as well as the colour.

Graded cards render in a slab frame with the grading company's label colour, so a PSA 9 in the grid reads as a slab rather than a photo. Each uploaded photo's average colour is sampled at save time and tints that card's tile and page. The hero value and card names use a condensed display face.

## On a phone

The app is installable. Add it to a home screen and it opens without browser chrome, with its own icon, in portrait, respecting the notch and home indicator. Phones get a fixed tab bar within thumb reach instead of the header row, and jump straight to scanning or adding a card from a long-press on the icon.

A small service worker makes that work and lets the shell open without a network, showing a plain "no connection" page. It deliberately never caches API responses or page HTML: prices, grades and the collection itself change, and a stale answer about what something is worth would be worse than no answer.

## Project layout

The repository is an npm workspace, so a second collectible can get its own app
without either one inheriting the other's assumptions. Root scripts fan out
across all of them.

```
apps/cards/              this app
apps/skins/              the same idea for CS2 items — see its own section below
packages/core/           code with no opinion about what is being collected:
                         the Markdown codec, the zip writer, the CSV reader,
                         chart geometry and the components both apps draw with
```

Inside `apps/cards`:

```
src/app/                 Next.js App Router pages and API routes
  /                      Portfolio: hero value, change, value chart, grading outlook
  /scan                  Batch capture with automatic identify, merge and save
  /collection            Card grid with search and game filter
  api/identify           POST — identify a card from uploaded photos
  api/uploads            POST photos / GET stored photo
  api/cards[/id]         CRUD; /price refreshes prices, /prices returns history
  api/prices/lookup      Price a not-yet-saved card
  api/prices/refresh     POST — refresh every card (?stale=24 limits to stale ones)
  api/export             GET — the collection as CSV (?type=sales for the sales ledger)
  api/cards/[id]/sales   GET / POST — a card's sales; POST removes the copies sold
  api/sales              GET all sales with realized totals; DELETE /api/sales/[id] undoes one
  api/submissions[/id]   Grading batches; PATCH adds/removes cards, marks sent, records grades
  api/alerts[/id]        GET the feed, POST marks all read, DELETE dismisses one
  api/cards/intake       POST — atomic add-or-merge used by scan mode
  api/backup             GET — the database and photos as one zip; /restore puts one back
  api/cards/[id]/acquisitions
                         GET/POST — what each copy cost; POST records another purchase
  api/collection         GET — the collection as Markdown; /rebuild rewrites it, /import reads it back
  api/import             POST — preview a CSV, or apply it with `apply: true`
  api/locations          GET — storage locations in use, for autocomplete
  api/sets/refresh       POST — fetch and store a set's published checklist
  api/auth               POST signs in, DELETE signs out (only when APP_PASSWORD is set)
  api/settings           Multipliers + provider status
src/lib/identify/        Claude vision call and the identification schema
src/lib/pricing/         Providers, matching heuristics, summary/valuation, refresh pipeline
src/lib/analytics.ts     Portfolio value series, grading outlook (min/max/upside) and timing verdict
src/lib/scheduler.ts     Hourly auto-refresh of stale prices (started from src/instrumentation.ts)
src/components/charts/   Inline-SVG portfolio line and min/max outlook band charts
src/lib/acquisitions.ts  Purchase lots: what each copy cost, consumed oldest first on a sale
src/lib/markdown/        The plain-text copy: format, one card as a document, the
                         on-disk mirror, and reading a collection back out of it
src/lib/zip.ts           Dependency-free streaming zip writer used by the backup
src/lib/csv.ts           RFC 4180 reader; src/lib/import.ts maps columns to cards
src/lib/sets/            Set checklist providers, caching and completion matching
src/lib/auth.ts          Optional password gate (Web Crypto, shared by proxy and routes)
src/proxy.ts             Guards every route when APP_PASSWORD is set
e2e/                     Playwright suite driving a real build
src/lib/cards.ts, db.ts  SQLite (better-sqlite3) repository and schema
src/components/          UI (add flow, card detail, price panel, settings)
tests/                   Vitest suites (providers with mocked fetch, valuation, repository)
```

## Scripts

```bash
npm run dev         # development server
npm run build       # production build
npm test            # unit tests (vitest)
npm run e2e         # end-to-end tests (playwright, boots its own servers)
npm run typecheck   # tsc (after generating Next route types)
npm run lint
```

Every script above runs from the repository root and covers every workspace.
To drive one app on its own, add `-w @collectcollect/cards` — which is how you
reach the app-only scripts, such as `npm run e2e:ui -w @collectcollect/cards`
for the Playwright suite in UI mode.

## Testing

Unit tests cover the pieces where a mistake is silent: price matching and the
provider adapters (against recorded responses, never the network), the
valuation and grading-outlook maths, the repository and its migrations, sales,
submissions, alert rules, and the password gate.

The end-to-end suite drives a real production build in Chromium against a
throwaway data directory. Identification and price lookups are intercepted, so
the tests never call Anthropic or a price API, but everything else, including
the database, runs for real. It covers adding a card by hand, duplicate
merging, scan mode's add/merge/set-aside behaviour, a sale and its undo, a
grading submission from draft to booked outcome, and the password gate. Both
suites plus lint, typecheck and build run in CI on every push.

## The skins app

`apps/skins` is the same engine — value over time, purchase lots, sales, the
plain-text mirror — pointed at CS2 items instead of cards. Run it with
`npm run dev -w @collectcollect/skins`.

The two apps share code but nothing else. The skins app keeps its own database
in its own directory (`SKINS_DATA_DIR`, defaulting to `apps/skins/data`), so
the two can run side by side from one shell without either seeing the other's
collection.

One thing about CS2 inverts a card-app assumption, and it shapes the schema:

- **A weapon, knife or glove is a unique object.** Its float — the 0-to-1 wear
  value — and its pattern seed are its identity. Two Field-Tested AK Redlines
  are different things worth different money, so they never merge into a
  quantity, and one row is one object.
- **A case, capsule or sticker is fungible.** Forty-seven Clutch Cases bought
  over two years at a dozen prices stack into one row, and the purchase lots
  matter there more than anywhere in the card app.

The float also decides the wear tier rather than sitting beside it: Factory New
through Battle-Scarred are just bands on the float scale, so where an import
claims a tier the float contradicts, the float wins.

**Getting an inventory in.** Three ways, and none of them writes anything until
you have seen what would arrive:

- **From Steam**, by SteamID64, for any inventory set to Public. An import is a
  statement of what you hold *now* rather than a pile of new purchases, so
  running it again on an unchanged inventory changes nothing; a stack that has
  grown gains a purchase of unknown cost, one that has shrunk gives up its
  newest lots, and an object Steam stopped listing is named rather than deleted.
- **From a spreadsheet**, which is the one that knows what you paid. Steam does
  not, so a file of your own purchases is what turns an inventory into a record.
- **One at a time**, where pasting the market hash name fills in the kind, the
  gun, the finish, the wear tier and the StatTrak flag.

Steam sends neither the float nor the pattern seed — those need an item's
inspect link resolved by a float service — so both stay blank rather than
showing a zero, which would read as a pristine Factory New.

**Where to sell** is the app's reason to exist. For each item it works out what
you would actually receive on each market, after that market's cut, and ranks
them — with one rule it never breaks:

> Steam is never compared against the others. It is where most CS2 trading
> happens and it usually shows the highest number, but what it pays is wallet
> funds that cannot be withdrawn. Ranking it against markets that pay money on
> net price alone would point you somewhere you would not be paid, so the two
> are listed apart and stay apart.

Trade locks are the other half of it. A difference you cannot act on for six
days is not a difference, so a locked item says so and its money is left out of
the total the page says you could realise today. And an item only one market
lists is reported as "nothing to compare" rather than being given a spread of
zero, which would read as a measurement.

The amount threshold in Settings is measured against the whole holding rather
than one copy: nine cents each across thirty-five cases is three dollars, and
it is one listing either way. The percentage stays per copy, where it means
something.

**Prices** come from Skinport and Steam, with CSFloat if you give it a key —
and from you, if you type one in, which overrides all of them on that item. The
two shapes are quite different, which the code is built around: Skinport
publishes its whole catalogue in one response, so a refresh loads it once and
every lookup reads from that; Steam answers one item at a time, about twenty
times a minute, behind a rate limit shared across the process. Nothing
estimates a price from a similar item or a neighbouring wear tier, so an item
nobody is listing reads as "not priced" rather than as a number that looks
measured and is not — and a refresh that found nothing is never written over an
item's last known value.

**Password.** Set `SKINS_APP_PASSWORD` — its own variable, and its own cookie.
Cookies are scoped to a host and not to a port, so two of these apps served from
localhost would otherwise hand each other their sessions.

Its plain-text mirror works exactly like the card app's, under
`<data>/collection/items/`, and carries the float, the pattern seed, the
applied stickers and their wear, every purchase lot and which lots each sale
took.
