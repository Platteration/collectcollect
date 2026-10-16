# CollectCollect

A personal cataloging app for trading cards: Pokémon, Yu-Gi-Oh!, Magic: The Gathering, sports cards (baseball, basketball, football, hockey…) and anything else in a sleeve.

It is also a family: the same repository holds apps for CS2 skins, retro games, comics, watches and whisky, each with its own database, its own price sources and its own rules about what counts as one object, sharing the engine underneath. See [The other apps](#the-other-apps).

Snap a photo of a card and CollectCollect:

1. **Identifies it** with Claude's vision model: game, name, set, collector number, year, rarity, printing variant (holo, 1st edition, refractor, autograph…) and, if it's in a slab, the grading company, grade and cert number; it also reads the centering as border ratios when the photo shows them.
2. **Looks up the going rate** for an **ungraded (raw)** copy and for **graded** copies (PSA / BGS / CGC / SGC) from live price sources.
3. **Keeps it in your collection** with quantity, condition or grade, purchase price, notes and a price history, and totals up what your collection is worth.
4. **Shows your portfolio** the way a brokerage app would: one headline number for the whole collection (valued at the grade or condition you recorded for each copy), the change over 1W / 1M / 3M / 1Y / all time, a value-over-time chart you can scrub, the cost of what you hold drawn beside it, your total return against what you paid, the split by game, and your top holdings. Each card page has its own value chart, the price you paid, and its return.
5. **Tells you when to grade.** Every ungraded card gets a min/max outlook: the band between a mid-grade outcome and a gem-mint outcome, plotted against what the raw copy is worth. When the gap above the raw line is at its widest and clears your grading fee, the card is flagged as a good time to grade; when it has narrowed, it says wait; when even a PSA 10 would not cover the fee, it says skip.

## Quick start

For a persistent cards-only installation, see [Self-hosting](docs/SELF_HOSTING.md).
Manual entry and CSV import work without API keys. The first-run checklist links
to setup, provider connection tests, and backups.

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY (and optional price-source keys)
npm run dev               # http://localhost:3000
```

Production: `npm run build && npm start`. Everything is stored locally in `apps/cards/data` (SQLite database, uploaded photos, and a Markdown copy of the collection); set `DATA_DIR` to move it.

> Upgrading from a version before the app moved into `apps/cards`? Your collection is still where it was. On start the app looks for a `data` folder above itself and uses the one it finds, saying so in the log. Move it to `apps/cards/data`, or set `DATA_DIR`, to settle it permanently.

Docker: `docker compose up -d --build cards` starts the card app on 3000 with its
own named volume at `/data`. Add skins with `docker compose up -d --build skins`
on port 3001. `docker compose up --build` still starts both apps. To build an image
directly, pick the app with a build argument:

```bash
docker build -t collectcollect .                            # the card app
docker build -t collectcollect-skins --build-arg APP=skins .
```

**Password.** Set `APP_PASSWORD` and the app asks for it once, then remembers the session for 30 days in a signed HttpOnly cookie. Leave it unset and there is no login at all, which is fine on a machine only you can reach. Failed attempts are rate limited, and changing the password invalidates existing sessions. Each session carries an id: signing out ends that one, wherever a copy of its cookie went, and *Sign out everywhere* on the Settings page ends every session issued so far — for the phone that was lost or the browser left signed in. The record lives in `sessions.json` in the data directory. Sessions from before this record existed are not recognised, so upgrading asks for the password once more.

> Even with a password, this is a single-user app holding one shared collection. It is meant for your own machine or private network, not for running a service for other people.

**Behind a proxy.** The login limiter and the per-route limits count attempts per client. Without a proxy every client is one client, and the `X-Forwarded-For` header is ignored — anyone can send one. Set `TRUST_PROXY=1` only when a reverse proxy in front of the app sets that header, and it will be read — as will `X-Forwarded-Proto`, which is what lets the session cookie be marked `Secure` and the response carry HSTS when the proxy terminates TLS. Compose binds both apps to `127.0.0.1`; put the proxy in front and change the bind address there, since neither app speaks TLS.

**Request origins.** Both apps refuse unknown public Host names and cross-site browser writes, including in passwordless mode. IP addresses, single-label names and private-use `.localhost`, `.local`, `.lan`, `.internal` and `.home.arpa` names work by default. Set `ALLOWED_HOSTS` to a comma-separated list of the names served by your reverse proxy, and have it preserve the public Host header. Scripts may omit browser Origin/Fetch Metadata headers, but JSON API bodies must use `Content-Type: application/json`. Multipart uploads and restores keep their existing format.

**Webhooks.** The alert webhook is posted to by the server itself, so it has to be an address on the public internet: `localhost`, `*.local`, and any private, loopback or link-local address are refused when saved, a name that resolves to one is refused at delivery, and the request does not follow redirects.

**What every response carries.** A content security policy that allows scripts only from the app itself, plus the one inline script that applies the theme before first paint, which is let through by a nonce minted per request; images from the app, `data:`/`blob:` and (for cards) any https host a price source's reference image might come from; nothing framed, nothing embedded. Alongside it: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a strict referrer policy, and a permissions policy that refuses the camera except where scan mode uses it. `GET /api/health` answers without a session — `{ ok, app, database, scheduler: { enabled, running, lastRunAt } }`, and nothing more, since it answers anyone — for a container health check or a proxy. `database` is true only when a query has just run through the live connection: a database file whose restore journal cannot be replayed reports false, with the reason in the log rather than the response, and an install with no database yet reports false without one being created. `ok` means the process answers.

**Limits on the expensive routes.** Identifying a photo (10 a minute), uploading (30), refreshing every price (6), pricing one card (120, since a scan or a bulk refresh sends one per card), reading a folder or a Steam inventory back in (6), importing a spreadsheet (30), downloading a backup or the folder (6), and restoring a backup or putting one back (6) each refuse with a 429 and a `Retry-After` past their limit. They are in memory and per process — protection against a runaway client or a double-clicked button, not a public API's defence. Only one whole-collection price refresh runs at a time, whoever asks: a second is told so with a 409, since the answer it wants is already being produced.

## How pricing works

| Source | Games | Key | What it provides |
| --- | --- | --- | --- |
| [PriceCharting](https://www.pricecharting.com/api-documentation) | all | `PRICECHARTING_TOKEN` (paid) | Ungraded **and graded** prices (PSA 10, Grade 7–9.5, BGS 10 and BGS 10 Black Label, CGC 10 and CGC 10 Pristine, SGC 10, TAG 10), asked one call a second |
| [PSA Public API](https://www.psacard.com/publicapi) | all | `PSA_API_TOKEN` (free account; PSA approves API access) | A graded card's grade, label, population and PSA's own scans from its cert number; no prices |
| [Pokémon TCG API](https://pokemontcg.io) | Pokémon | optional `POKEMONTCG_API_KEY` | TCGplayer market price per printing (normal / holo / reverse / 1st ed.), Cardmarket EUR |
| [Scryfall](https://scryfall.com/docs/api) | Magic | none | USD / EUR, foil and non-foil |
| [YGOPRODeck](https://ygoprodeck.com/api-guide/) | Yu-Gi-Oh! | none | TCGplayer, eBay, Cardmarket, per-set price |
| Manual entry | all | — | Your own ungraded / graded prices, which override everything else |

The first four also supply set checklists for completion tracking, except PriceCharting.

For each card the app shows:

- **Ungraded (raw NM)** market price and where it came from.
- **Graded copies**: real graded prices when a source has them (PriceCharting or your manual entry). Grades with no real data are shown as **estimates** (`est.`) computed as *ungraded price × multiplier*; the multipliers live in Settings and default to conservative round numbers, so tune them per your experience (TAG 10 and TAG 9 are in the defaults for a new install; an existing Settings keeps its own rows, so add them there to estimate TAG grades). When more than one source reports the same grade, the figure shown is their average and the card page lists each source behind it; a price you enter yourself still wins its grade outright. Today PriceCharting is the only source of graded prices, so the average appears once a second one is wired in.
- **Your copy**: the value of the specific copy you own. A PSA 9 uses the PSA 9 / Grade 9 price; a raw Lightly Played copy uses the ungraded price × the LP condition multiplier.

A refresh stores a snapshot when anything about the price changed, so a card's detail page shows how its price has moved and the portfolio chart fills in; one that finds the same prices only notes when it checked, so a card refreshed daily for a year does not carry a year of identical rows. A refresh that returns no price (source down, no source configured for that game, no match) is reported but never stored over a card's last known value.

**Keeping history flowing.** The server re-prices any card whose latest snapshot is older than `AUTO_REFRESH_HOURS` (default 24, set 0 to disable) once an hour while it is running, and the Portfolio page has a *Refresh all prices* button. The min/max curves need a few refreshes before the timing verdict says anything stronger than "not enough history yet".

**Condition from the photo.** Identification also reports centering, corners, edges and surface, plus a conservative-to-optimistic estimate of the 10-point grade a raw card would likely receive and a caveat naming what the photo could not show. That estimate seeds the card's raw condition when you save it, and prices a "likely outcome" line in the grading outlook. The centering is also read as border ratios (left/right and top/bottom, front and back when visible) and seeds the card's centering fields. It is a first look, not a prediction of what a grader would return.

**Grading plans.** Each raw card carries a plan: undecided, plan to grade, at the grader, or keeping raw. A card is flagged **Ready** when the timing verdict is good and its upside after the fee clears the thresholds in Settings (default $40 and 50% of the raw price). The portfolio page counts ready cards, totals their upside, and lets you filter by plan; when a card comes back from the grader, edit it and enter the grade, or record it on the submission page with its cert number.

**Submissions.** `/submissions` groups raw cards into a grading batch. Adding a card captures what it is worth raw and what gem mint would fetch at that moment; marking the batch sent moves those cards to "at the grader"; entering the grades that came back applies each grade to its card, so it is valued as a graded copy from then on, and books the batch's net outcome (value returned less raw value in less fees). Per-card lines show which cards paid for themselves and which did not, which is the feedback that makes the timing verdict worth trusting.

**Grading reports and centering.** A graded card's page links to the grading company's public report for its cert number: PSA, CGC, TAG, ACE and AGS by the cert itself, Beckett and SGC to their lookup pages. With `PSA_API_TOKEN` set, *Look up on PSA* fills the grade, label, population and PSA's own front and back scans from PSA's record (shown from PSA's site, never stored here), and can fill the card's blank set, number and year. For every other company, and for PSA without a token, *Enter the report by hand* takes what the report prints: the subgrades (four for Beckett, CGC and ACE, eight for AGS), TAG's 1000-point score with its centering, corners, edges and surface breakdown, the population, and the centering as the report writes it ("54L/46R 49T/51B"). Nothing is fetched from any company's website; TAG's terms forbid it, and the others offer no API. The report and the centering are kept with the card, written to its Markdown file, and come back from a restore.

Centering is recorded on every card, raw or graded, as border ratios: front and back, left/right and top/bottom, typed in the way a grader writes them, taken from a report, or read from the photo. Each company publishes how far off a card may be at each grade, and the card page says how far the measured centering lets it grade with each ("Centering allows up to PSA 9 · BGS 9 · …"). Those limits were taken from guides quoting the published standards and are marked approximate; check the company's page before sending a card in. The 3D view shifts the print by the measured centering.

**Scan mode.** `/scan` is for working through a binder or a stack. Shoot one card at a time with the camera, or drop in a batch of photos. Each shot runs through upload, identification and saving on its own, two at a time, and a card that matches something you already own is merged as an extra copy automatically. Anything the model was less than 80% sure of, or that matches more than one card you own, is set aside for review instead of being saved unattended.

**Duplicates.** Saving a card that matches one you already have (same game and name, with the same number or set) offers to add it as another copy instead. A copy only joins a row it is interchangeable with: the same grade, grading company and cert number (two slabs are two objects), and the same variant, language and condition, since each of those is valued differently. Anything else is set aside for a decision rather than merged.

**When a value changes.** Recording a grade, a condition or a price of your own, or changing the multipliers in Settings, revalues the card at once from the prices already fetched; nothing waits for the next refresh. A refresh that learns which product a source matched remembers it without counting as an edit, so refreshing the whole collection does not reorder it. If a source matched the wrong product, *Not this card* on the card page forgets the match and searches again by name, set and number; editing those fields does the same. A source is only believed when its best answer plausibly is the card: every word of the name (Magic included: a misspelt name is for you to correct, not for Scryfall's closest match to price), and the number or the set agreeing when you gave one.

**Grading outlook math.** *max* is the PSA 10 price (real if a source reports it, otherwise ungraded × the PSA 10 multiplier); *min* is the PSA 8 / Grade 8 price on the same basis, falling back to the raw price; *upside* is max − raw − grading fee (Settings). A measured centering caps *max* at the best grade the company's centering limits allow (a 60/40 front can be a PSA 9 at most), priced at that grade or the next one down that has a price, and holds the photo's likely grade there too; the verdict, the Ready flag and the ready-to-grade alert follow. "Good time to grade" means today's upside is within 10% of the highest upside in the card's history and positive.

Sports cards have no free price API; without a PriceCharting token you can still enter prices manually.

**Sales.** Log a sale from a card's page: copies leave the collection, the cost basis is captured at sale time so later edits don't rewrite history, and the portfolio shows realized gains (proceeds less fees less cost) beside unrealized ones. A sale can be undone, which puts the copies back. Fully sold cards stay in the collection greyed out with a "Sold" badge so their history survives.

**Alerts.** Every price refresh checks whether anything is worth mentioning: a card crossing your ready-to-grade thresholds, a move bigger than the percentage set in Settings, or real graded sales appearing where the app previously had only a multiplier estimate. A price of your own that you change past that percentage raises the same alert the moment you save it. Alerts collect in `/alerts` with an unread count in the nav. Setting a webhook URL POSTs each alert as JSON so you can forward them to email, push or chat through a service you control; a failing webhook is logged and never breaks a refresh.

**Appraisal report.** `/report` is a printable valuation of everything you own, with photos, identifications, grades, per-copy and total values, and the source and date behind each price. Print to PDF from the browser. Set the owner name in Settings.

**Import.** `/import` reads a CSV, whether it is this app's own export or a spreadsheet from another collection tool. Columns are matched by name, so headers like “Card Name”, “Edition”, “Qty” or “Price Paid” usually need no editing, and game and condition names are understood in the forms people actually write them ("Yu-Gi-Oh!", "Lightly Played", "VG"). A preview shows the matched columns, which columns were ignored, and any row it could not use, before anything is written. Rows matching a card you already own merge into it rather than duplicating; names are matched however their accents are cased ("ÉLECTRODE" and "électrode" are one card). One import reads at most 5,000 rows, and the preview says how many it left for another file.

**Set completion.** `/sets` lists every set your collection touches. Fetch a set's published checklist and it shows how complete the set is, which cards are still missing, and which you already have. Ownership is matched on collector number however it is written ("4/102" against "4"), falling back to the card name. Checklists come from the same sources as the prices: the Pokémon TCG API, Scryfall for Magic, and YGOPRODeck for Yu-Gi-Oh!. Sports cards have no checklist source, and the page says so rather than offering a button that cannot work.

**Where a card is.** Each card can record where it is physically kept ("Binder 2, page 4", "Slab box"). The Collection page filters by location, including a "no location recorded" option for what still needs putting away, locations already in use are offered as you type, and several cards can be filed at once. The location is searchable, exported, imported, and printed on the appraisal report, which is what makes the report useful for actually locating an insured card.

**Photos you did not keep.** A card stores one photo, but the add screen writes a file for every photo it is given: the back and slab-label photos, the frames you re-took. Once a day the app deletes uploaded photos that no card and no scan points at and that are more than 24 hours old, so the data directory — and every backup taken from it — does not grow forever. It never touches a file the app did not write, and it waits while a backup or a restore is running.

**Bulk actions.** Tick several cards on the Collection page to refresh their prices, set a grading plan, add them to a draft submission, or delete them in one go.

**Backup and restore.** Settings offers a single zip holding a consistent copy of the database (taken through SQLite's own backup, so it is safe while the app is running) and every photo, and takes one back to restore it. A restore validates the whole archive and opens its database before touching anything, refuses names that would escape the data directory or files the app did not write, and moves the collection being replaced into a dated folder rather than deleting it. Those folders are listed in Settings, and any of them can be put back with one click — which moves the collection that is live aside in its turn, so that is undoable too. The swap itself is ordered so the app is never left with no database: the incoming one is brought beside the live one first, where a full disk can still fail harmlessly, and the exchange is two renames. It holds the archive in memory, so it is capped at 64 MB, which is also the largest request body the app accepts; a larger collection is restored by unpacking the zip into the data directory with the app stopped. It also checks what the database carries besides rows: a SQLite file can hold code, and a trigger in a restored database would run on every later edit of your collection, so an archive carrying a view or a trigger this app does not create is refused, and every trigger and index in it is replaced by the app's own before anything is written to it. A price snapshot whose summary is not JSON is refused too, since the price history reads every one. What a restore brings that is JSON but not shaped like this app's own is read field by field rather than trusted: a price summary's figures, tables and quotes each fall back on their own, and a scan draft whose photos, details or status are not ones this app writes is passed over rather than taking the Scan page down.

The small copies of photos that the collection grid shows (`*.thumb.jpg` beside each photo) are not carried; they are made again from the photos as they are first shown. A photo the collection points at that is not in `uploads/` is never a reason to refuse. A backup leaves it out and names the card — in the archive's manifest, in the log, and on Settings before the button is pressed. A restore or put-back of a collection that names a photo it does not carry clears that reference on its private staging copy, so the card comes back without a photo and a scan draft without that upload (a draft with no upload left is discarded), and lists what it cleared in the result. A restore is refused while a whole-collection price refresh is running, and waits up to ten seconds for the single-card lookups a scan or a save fires in the background before refusing with that reason. If the rollback of an interrupted restore finds a file at both ends of a move it recorded, it leaves both, writes the pair to `<database>.restore-conflicts.json`, starts the app on the collection the journal identifies, and says so at boot and on Settings until a later restore or put-back completes; when the two copies are of the database file itself it refuses to start and names both paths.

**What each copy cost.** Cards get bought more than once, rarely at the same price. Every purchase is recorded as its own lot — when, how many, what each one cost, and where from — so a second copy never overwrites what the first one cost. Adding a copy of a card you already own asks for that copy's price rather than just bumping a number. Selling takes the copies you have held longest first, and the gain is measured against what *those* copies cost, not against an average and not against the newest price. Undoing a sale puts the copies back in the lots they came from.

A cost that was never recorded stays unrecorded rather than becoming zero: a card out of a bulk lot or a childhood shoebox is counted separately and left out of the return, because pricing it at nothing would report it as pure profit. `purchase_price` is now the average across the copies you still hold, worked out from the lots. Editing the quantity directly is treated as a correction to the count, not a purchase — the copies it adds have no price attached, and the app says so.

Collections from before this existed get one lot per card from what was already known, and the same rule applies to Markdown files written by an older version.

**Your collection is also plain text.** Every card is written to a Markdown file under `data/collection/cards/`, rewritten whenever that card changes: front matter holding the record (name, set, number, grade, copies, what you paid, where it is kept) and, below it, the same card written for a person — its photo, your notes, its prices as recorded (the newest thousand; the database holds the rest), and any sales. `index.md` lists the whole collection in one table, `README.md` in that folder explains the format to whoever finds it.

This exists so the collection outlives the app. If CollectCollect is never updated again, or you would rather keep your catalogue somewhere else, the folder is already a complete, readable record that any text editor, spreadsheet, git repository or notes tool can open — no database, no export step, nothing to run. Settings has *Download the Markdown* for a zip of it, *Rewrite the files* to bring them up to date from the database, and *Rebuild from these files* to read a collection back in. Reading files back matches each file to the card it describes — by the id in the file, or, when that id belongs to something else, by the card itself — so importing the same folder twice changes nothing the second time, and a folder from somewhere else can only add to a collection, never overwrite a card it has nothing to do with. Rewriting never deletes: a file describing a card the database does not have is counted and left alone, since the likeliest reason for one is that the folder is the copy that survived. Writing is best-effort by design: a full or read-only disk degrades the plain-text copy and is reported in Settings, but never stops a card being saved. Set `MARKDOWN_MIRROR=off` to switch it off.

The files hold every purchase and the newest thousand recorded prices per card or item — including which purchase each sale drew from, and for skins the best quote from each market — but not the listing URLs or volumes behind each quote, nor the note of when an unchanged price was last checked. Photos stay in `data/uploads/`, which the card files link to, so keep the two together — the Markdown download is text only, while the full backup carries both.

The archive is written and read by a small built-in zip writer and reader rather than a dependency. Tests check the writer against the system `unzip` and Python's `zipfile`, read back archives made by the system `zip` in both stored and deflated form, and confirm that a corrupted payload, a doctored entry name, a path that escapes, an oversized expansion and a database that will not open are each refused with the collection left untouched.

**Export.** The Collection page has an *Export CSV* button (also `GET /api/export`) with every card, its grade or condition, purchase price, and latest ungraded / PSA 10 / your-copy prices.

## Sports cards

The card app covers sports cards as a game type of its own rather than a separate app: the grading verdict, the outlook chart, submissions, sales and the report all apply unchanged. Choosing **Sports** in the form adds what a sports card has and a TCG card does not:

| Field | Notes |
| --- | --- |
| Player | the card's name field, labelled Player |
| Sport, manufacturer / brand | baseball, basketball…; Topps, Panini, Upper Deck… |
| Team | |
| Rookie card | flag |
| Parallel / refractor | the parallel's name and colour as printed: Gold Refractor, Silver Prizm, Blue Wave 1:25 |
| Serial number | `12/99`, however it was typed (`12 of 99`, `#12/99`) |
| Autograph, relic / patch | flags |
| Grading company, grade, cert | PSA, BGS, SGC, CGC, TAG |
| Subgrades | centering, corners, edges, surface, shown for BGS slabs |

**One specific object, or a stack?** A serial-numbered card is one specific object: `12/99` names it, so it is never merged with another copy and nothing is merged into it. So is a graded card at its own grade. Raw copies of the same card stack only when they are the same parallel: a base card and its Refractor are two rows, and two base copies are one row with a quantity of two and a purchase lot each.

**Pricing.** There is no free sports-card price API. PriceCharting (`PRICECHARTING_TOKEN`, paid) is the only source, through the same adapter as every other game: the search carries the year, brand, set, player, number and the parallel, autograph and relic words the way PriceCharting names its listings, and a listing that names the parallel outranks the base card when the copy is one. Without a token, type the ungraded and graded prices in by hand on the card; they override every source and the chart, verdict and report work from them. Photo identification reads the team, RC logo, parallel, serial numbering, autograph and relic, and the four subgrades on a BGS label. Sports cards have no set-checklist source either, and the Sets page says so.

## Card identification

**Collecting goals.** `/goals` holds wishlists, target quantities, priorities,
optional dates and a budget for remaining cards. Each price ceiling is your
shopping limit; unknown ceilings remain unknown. Progress follows current
holdings, assigning each copy once within a goal and preferring specific
printings. A copy can count toward independent goals. Fetch a set before buying
its first card and choose *Complete this set*, or enter a manual wishlist for
any game. *Add acquired card* prefills the normal card form without recording a
purchase until you save. Goals are included in database backups and the
Markdown folder, and can be archived without removing their history.

Steam imports use a reviewed server snapshot tied to the selected account.
Changing the SteamID clears the preview. Apply consumes that exact snapshot
once within ten minutes; a restart or expiry requires another preview. The
result lists every missing item, lower stack count and failed row without
silently removing anything.

Identification runs on Claude (`claude-opus-5` by default; override with `CLAUDE_MODEL`). Photos are downscaled server-side before being sent. The model returns a structured identification with a confidence score and alternative matches when the card is ambiguous; you can add a back or slab-label photo, give it a hint ("it's Japanese"), and re-identify. Without an Anthropic key the app still works for manual entry and pricing.

## Look and feel

Dark is a **wireline** theme on the illustrated tabletop's deep-ink ground (`#19232d`, with panels at `#24323e`): the interface is drawn in white hairlines, so almost nothing is filled. That leaves saturation to mean something, and the only colours that carry are the ones that should — green when the collection is up, red when it is down. The portfolio line takes that colour and its area is a gradient of it, fading out towards the baseline so the line stays the loudest mark. Light mode keeps the validated chart palette and reads as an ordinary document.

The theme follows your system by default; the switch in the header pins it to light or dark and remembers the choice. Beside it, the palette menu (the same choice as the picker in Settings) offers eight palettes — teal, the default described above, and amber, sky, indigo, violet, plum, copper and slate — each with its own ground, panels and accent in light and in dark; light and dark stay a separate choice. A palette never touches the gain and loss colours, the chart series, a card's artwork or a grading company's label. An inline script resolves both choices to `data-theme` and `data-scheme` attributes before the first paint, so there is no flash of the wrong theme, and both the CSS variables and Tailwind's `dark:` utilities key off those attributes rather than duplicating the condition. The browser chrome colour follows the ground actually showing, so a light page never sits under black chrome. A choice the browser will not store (private browsing, storage blocked) still applies to the page, with a note under the switch that it cannot be saved; printing uses the light theme for the length of the print.

Chart colours are not chosen by eye. `--chart-surface` follows what a chart sits on — the panel inside a `card-surface`, the ground elsewhere — so a hover halo is always cut from its own surface rather than from a darker colour the palette no longer uses, and the categorical slots are checked with the dataviz palette validator against both dark surfaces (`#19232d` and `#24323e`, re-run when the tabletop palette replaced the near-black ground) and pass its lightness band, chroma floor, colourblind separation and contrast checks; lighter values that looked better sat outside the band and were rejected. The green and red are deliberately brighter than that band, because they are a status pair rather than a categorical one, and direction is always carried by an arrow and the sign of the number as well as the colour. That validation was run against teal's surfaces; for every palette, each app's `tests/family-theme.test.ts` holds the text, the muted text and the gain and loss text to 4.5:1 on its ground, panel and raised surface, the accent to 3:1 on each, and the accent's ink to 4.5:1 on the accent, in light and dark.

Each card is drawn as the object it is. On its own page the card tilts towards the pointer and catches the light; in the grid it lifts a little on hover. Its surface shows the wear its grade implies: a 10 is pristine and glossy, a 9 has a soft corner and a speck of dust, and as the grade falls it gains whitened edges, a fingerprint, a print line, scratches, dents, an off-centre print (placed by the measured centering where there is one), yellowing, and finally stains and a crease — The grade sets how much wear there is and how likely each kind is; a hash of the card's id decides which kinds this card actually has, leaning one card towards scuffs and dents and another towards stains, so two cards of one grade differ in kind and not only in place, and a card always looks the same (and only some cards yellow), with everything but dust and print lines kept out of the middle of the art. A holo, reverse holo, foil or refractor — read from the card's printing variant or its rarity, so nothing new is recorded — carries a rainbow that slides as the light moves: across the art box of a holo, around it on a reverse holo, over the whole of a foil or refractor, dimmer as the card wears. Its pattern — plain sheen, stripes, cosmos, cracked ice or starlight — is drawn from the card's id too, the fancier ones likelier on a better-graded card. A worn foil's edges show silver rather than white, and from a 4 down the foil lifts at a corner. A raw card curls as it wears, a foil one sooner; a slabbed card is held flat. A raw card is read from its condition (NM through DMG); a graded one from its grade, and when the photo was identified, what the model said about corners, edges, surface and centering decides where the wear concentrates. Graded cards sit inside a three-plane acrylic slab with the grading company's label colour, so a PSA 9 in the grid reads as a slab rather than a photo. It is CSS and one inline SVG, no library, and it stays flat for people who ask for reduced motion and when printing. Each uploaded photo's average colour is sampled at save time and tints that card's tile and page. The hero value and card names use a condensed display face.

## On a phone

The app is installable. Add it to a home screen and it opens without browser chrome, with its own icon, in portrait, respecting the notch and home indicator. Phones get a fixed tab bar within thumb reach instead of the header row, and jump straight to scanning or adding a card from a long-press on the icon.

A small service worker makes that work and lets the shell open without a network, showing a plain "no connection" page. It deliberately never caches API responses or page HTML: prices, grades and the collection itself change, and a stale answer about what something is worth would be worse than no answer. Nor does it answer anything under `/api/`, a page's address included, so the way to Google and back during a sign-in always reaches the server.

Five destinations fit on the tab bar; the last one is labelled *More* and leads to Settings, where the rest are listed. The skins app is installable in the same way, with its own icon and its own service worker. Because a service worker's scope is an origin and each app's worker clears every cache it does not own, the two apps have to be served from different origins — which two ports are, and which two paths on one host are not.

The repository is an npm workspace, so a second collectible can get its own app
without either one inheriting the other's assumptions. Root scripts fan out
across all of them.

```
apps/cards/              this app
apps/skins/              the same idea for CS2 items — see its own section below
apps/retro-games/        four apps on the shared domain engine; each is a spec
apps/comics/             (fields, rules, price sources, prompt, seed data) plus
apps/watches/            the little that only it knows, and its own README
apps/whisky/
packages/core/           code with no opinion about what is being collected:
                         the Markdown codec, the zip writer, the CSV reader,
                         chart geometry, the components every app draws with,
                         and under src/domain the engine that runs an app
                         from its spec (schema, ledger, pricing, mirror, CSV,
                         identification, backup, routes and pages)
packages/create-domain/  scaffolds a new app on the engine in one command
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

Each app also has a root shortcut for its dev server: `npm run cards` (3000),
`npm run skins` (3001), `npm run retro-games` (3002), `npm run comics` (3003),
`npm run watches` (3004) and `npm run whisky` (3005).

## Testing

Unit tests cover the pieces where a mistake is silent: price matching and the
provider adapters (against recorded responses, never the network), the
valuation and grading-outlook maths, the repository and its migrations, sales,
submissions, alert rules, and the password gate.

The end-to-end suites drive real production builds in Chromium against
throwaway data directories. Identification and price lookups are intercepted, so
the tests never call Anthropic or a price API, but everything else, including
the database, runs for real. It covers adding a card by hand, duplicate
merging, scan mode's add/merge/set-aside behaviour, a sale and its undo, a
grading submission from draft to booked outcome, and the password gate. The
skins app has its own suite, and the whisky app's stands for every app on the
domain engine: it drives the shared portfolio, collection, item, report, add
and import pages, plus the one thing that is whisky's alone — opening a bottle,
which splits a copy off a stack and freezes what it was worth. Every suite plus
lint, typecheck and build runs in CI on every push.

## The other apps

Four more collections run on a shared **domain engine** in `packages/core/src/domain`. An app on it is a description of what it collects, a `DomainSpec`: typed fields (searchable, filterable, private), a title and a detail line, the rule for whether a row is one specific object or a fungible stack, its price providers and how their answers become one value, an identification prompt, settings, alerts, the report layout and sample data. From that the engine provides everything the card and skins apps wrote by hand: the SQLite schema with column migrations, validation, search and filters, add-or-merge intake, purchase lots with oldest-first cost basis, sales and realised gains, price refresh with a manual-entry source and hand-entered history points, the portfolio and its chart, alerts with a webhook, storage locations, the printable report (private fields off unless asked), CSV import and export, uploads and Claude vision identification, the Markdown mirror and restore, backup, the password gate, every API route and every page. Each app's route files are one line each, and its pages render from the spec with a small hook for what only that domain knows.

`node packages/create-domain/index.mjs <id> --name … --singular … --plural … --prefix … --port …` scaffolds a new one with a working starter spec, tests and README.

| App | Port | What it tracks | One object, or a stack? | Price sources |
| --- | --- | --- | --- | --- |
| [Retro games](apps/retro-games/README.md) | 3002 | cartridges and discs, loose / CIB / sealed / graded (WATA, VGA, CGC), box, manual and cart condition, variants | graded copies are unique; identical loose, CIB or sealed copies stack | PriceCharting by completeness (paid), manual; grade-or-wait verdict on sealed and complete copies |
| [Comics](apps/comics/README.md) | 3003 | single issues, key-issue flags, raw or slabbed (CGC, CBCS, PGX), page quality, signature series | slabs are unique; identical raw copies stack | PriceCharting by grade (paid, column mapping unverified), manual; cert-verification stub; grade-or-wait verdict on raw copies |
| Sports cards | 3000 | part of the card app: team, rookie, parallel, serial numbering, autograph, relic, BGS subgrades | serial-numbered and graded cards are unique; raw copies stack within a parallel | PriceCharting (paid), manual; there is no free sports API |
| [Watches](apps/watches/README.md) | 3004 | brand, model, reference, private serial, movement, case, dial, box and papers, service history | always unique | deliberately manual-only / frozen — no market source planned; manual with dated history; insurance appraisal with serial and photo switches |
| [Whisky](apps/whisky/README.md) | 3005 | distillery, expression, age, cask, strength, size, bottle or batch, sealed or open, fill level | sealed identical bottles stack, numbered and open bottles are unique | deliberately manual-only / frozen — no market source planned; manual with dated history; an opened bottle's value is frozen and left out of the total |

They keep the conventions of the two older apps: everything self-hosted and local-first, one SQLite file per app in its own data directory (`<PREFIX>_DATA_DIR`), an optional password (`<PREFIX>_APP_PASSWORD`), hourly auto-refresh (`<PREFIX>_AUTO_REFRESH_HOURS`), and every item mirrored to Markdown under `data/collection`. Photo identification and PriceCharting use the same keys as the card app. Each has unit tests for its schema, its merge rule and its price adapter against a fake `fetch`. The pages they share are driven end to end by the whisky app's Playwright suite, so a change to the engine's portfolio, collection, item, report, add, import or login pages is caught for all of them at once.

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
  grown gains a purchase of unknown cost, one Steam shows fewer of is named
  rather than shrunk (the rest are as likely in a storage unit, which Steam does
  not show, as gone), and an object Steam stopped listing is named rather than
  deleted. Nothing an import does can lose what a copy cost.
  What a re-read does not mention, it does not forget: a public read carries no
  trade lock and a bare description carries no stickers, and neither wipes the
  lock, the stickers, the name tag, or the notes and price you filled in.
- **From a spreadsheet**, which is the one that knows what you paid. Steam does
  not, so a file of your own purchases is what turns an inventory into a record.
  One import reads at most 5,000 rows, as the card app's does, and the preview
  says how many it left for another file.
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

An item's value is what the best market that pays out in money would hand you
after its cut, and the inventory total is the sum of those. When only Steam
lists an item, its wallet figure stands in, labelled as wallet funds and never
compared with money. The highest listing anywhere is still recorded beside it,
and each market's proceeds after fees are on the item's page.

**Prices** come from Skinport and Steam, with CSFloat if you give it a key —
and from you, if you type one in, which overrides all of them on that item. The
two shapes are quite different, which the code is built around: Skinport
publishes its whole catalogue in one response, so a refresh loads it once and
every lookup reads from that; Steam answers one item at a time, about twenty
times a minute, behind a rate limit shared across the process. Nothing
estimates a price from a similar item or a neighbouring wear tier, so an item
nobody is listing reads as "not priced" rather than as a number that looks
measured and is not — and a refresh that found nothing is never written over an
item's last known value. A refresh that finds the same prices as last time only
notes when it checked, which the item page shows beside the price, so an item
refreshed every hour for a year does not carry a year of identical rows.

**The inventory page** sorts by name, value or date and shows 120 tiles a
page; the count and total at the top are over everything the filters match,
whichever page is showing.

**Password.** Set `SKINS_APP_PASSWORD` — its own variable, and its own cookie.
Cookies are scoped to a host and not to a port, so two of these apps served from
localhost would otherwise hand each other their sessions. Sign-in with Google
works as in the card app (see Deploy), with variables of its own:
`SKINS_APP_URL`, `SKINS_GOOGLE_CLIENT_ID`, `SKINS_GOOGLE_CLIENT_SECRET`,
`SKINS_GOOGLE_ALLOWED_SUBS` and `SKINS_GOOGLE_ALLOWED_EMAILS`. One Google client
can serve both apps, with both callback addresses on it; who may sign in is
still each app's own list.

**Keeping history flowing.** The server re-prices anything whose latest price
is older than `SKINS_AUTO_REFRESH_HOURS` (default 24, set 0 to disable) once an
hour while it is running, and `/spread` has a button that does the whole
inventory now. Only one pass runs at a time, whoever starts it — a refresh
still working through four hundred items must not have another started on top
of it, so the button answers 409 while the hourly pass is running, and the
hourly pass simply waits for the next hour while the button's is.

**Selling.** Purchases and sales share one panel on an item's page, because
they are one ledger read from two ends: a sale takes copies out of the oldest
purchase still holding any, and undoing it puts them back where they came from.
A purchase that has been sold from cannot be removed — that would rewrite money
that has already changed hands.

**Taking it elsewhere.** The plain-text mirror works exactly like the card
app's, under `<data>/collection/items/`, and carries the float, the pattern
seed, the applied stickers and their wear, every purchase lot and which lots
each sale took. Its switch is `SKINS_MARKDOWN_MIRROR=off` — its own, so the
card app's `MARKDOWN_MIRROR` never reaches it. There is also a CSV export in
the columns the importer reads back, and a printable valuation at `/report`
that lists an unpriced item as unpriced rather than counting it as worth
nothing.

**Backup and restore** work as in the card app, minus the photos: one zip of
the database and its plain-text copy, a restore that moves what it replaces
into a dated folder, and a list of those folders in Settings from which any can
be put back. An archive from the card app is refused by name rather than
unpacked into the wrong place. The same waits apply — a restore tells a running
whole-inventory refresh to stop and gives it ten seconds, and waits up to ten
seconds for a single-item lookup — and an interrupted restore's rollback
records, rather than refuses over, two copies of a folder.

## Running it

For a persistent cards-only installation, see [Self-hosting](docs/SELF_HOSTING.md).
Manual entry and CSV import work without API keys. The first-run checklist links
to setup, provider connection tests, and backups.

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY (and optional price-source keys)
npm run dev               # http://localhost:3000
```

Production: `npm run build && npm start`. Everything is stored locally in `apps/cards/data` (SQLite database, uploaded photos, and a Markdown copy of the collection); set `DATA_DIR` to move it.

> Upgrading from a version before the app moved into `apps/cards`? Your collection is still where it was. On start the app looks for a `data` folder above itself and uses the one it finds, saying so in the log. Move it to `apps/cards/data`, or set `DATA_DIR`, to settle it permanently.

### Deploy

Docker: `docker compose up -d --build cards` starts the card app on 3000 with its
own named volume at `/data`. Add skins with `docker compose up -d --build skins`
on port 3001. `docker compose up --build` still starts both apps. To build an image
directly, pick the app with a build argument:

```bash
docker build -t collectcollect .                            # the card app
docker build -t collectcollect-skins --build-arg APP=skins .
```

Compose gives each app a 2 GB memory limit: a request body is buffered whole, up to 64 MB, so a few uploads or restores at once are the high-water mark. `bash scripts/release-candidate.sh <version>` validates a release candidate of the card image on this machine — the whole gate, a container boot, a goal surviving a restart — and packages the image with the candidate Compose file into `release/`, publishing nothing ([Self-hosting](docs/SELF_HOSTING.md) says how to try one).

**Password.** Set `APP_PASSWORD` and the app asks for it once, then remembers the session for 30 days in a signed HttpOnly cookie. Leave it unset and there is no login at all, which is fine on a machine only you can reach (each app says so in its log at startup). Failed attempts are rate limited — eight a minute per client, reserved before the password is checked, so firing guesses in parallel buys nothing — and changing the password invalidates existing sessions. Each session carries an id: signing out ends that one, wherever a copy of its cookie went, and *Sign out everywhere* on the Settings page ends every session issued so far — for the phone that was lost or the browser left signed in. The record lives in `sessions.json` in the data directory, and a sign-out that cannot be written there says so rather than reporting success. The login page shows nothing of the app — no navigation, no unread-alert count — to someone who is not signed in. The cookie is signed with a random key kept beside it in `session-secret`, so a stolen cookie is no help to anyone guessing the password; `APP_SECRET` replaces that key if you would rather set one (make it random, `openssl rand -hex 32`: under sign-in with Google with no password beside it, one shorter than 32 bytes signs nobody in, below). Neither file is in a backup: a restore onto a new machine asks for the password once more. So does upgrading past the point either was introduced, since older sessions are not recognised.

**Sign in with Google.** Beside the password, or in its place, the app can let you in with a Google account: yours, and only the accounts you name. It needs a Google OAuth client of type *Web application* whose authorised redirect URI is the app's address followed by `api/auth/google/callback` (`https://cards.example.com/api/auth/google/callback`), and these variables: `APP_URL`, that address (the site's root, https, or `http://localhost` and `http://127.0.0.1` on this machine), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and who may sign in: `GOOGLE_ALLOWED_SUBS`, Google's ids for the accounts, and/or `GOOGLE_ALLOWED_EMAILS`, addresses Google says are verified, each a comma- or space-separated list (an address is compared without regard to case). Prefer ids. An id names one Google account for good; an address is only as good as Google's check of it, and only for a `gmail.com` address or one in a Google Workspace domain does Google answer for the address itself: for any other, Google checked it once, when the account was made, and a domain that lapses and is registered again, or a mailbox provider that gives the address to someone else, can put another Google account behind the same verified address. The log names the id of each account let in by its address alone (once per account while the server runs), so the first sign-in tells you the id to move to `GOOGLE_ALLOWED_SUBS`. The login page then offers *Sign in with Google*: the browser goes to Google and comes back to `api/auth/google/callback`, where the app checks the answer — the code flow with PKCE, a state and a nonce held in a short-lived `__Host-` cookie, signed (not encrypted) with a random key the server process makes for itself and never with the key sessions are signed with, since anyone may start a sign-in (one under way when the server restarts goes back to the login page), and Google's signature, issuer, audience, expiry and nonce on the ID token (the shared kit's `google.js`, kept in `packages/core/src/kit`) — and then the list. An account on it gets the same session cookie the password gives, so it lasts 30 days, *Sign out* and *Sign out everywhere* end it, and the login page and the gate treat it alike; anything else lands back on the login page, which says "Sign-in didn't complete." once. The log names Google's id for an account the list turned away, so a first sign-in tells you the number to add; beyond that and the id of an account let in by its address (above), nothing from Google is shown or logged. The callback calls Google at most ten times a minute for one client (counted as the login limiter counts one, below). Setting any `GOOGLE_` variable turns the gate on whether or not the rest holds: until it does, nobody can sign in that way, the login page says it is not fully set up, and the log names what is missing or malformed, never a value — an empty list counts as missing, since it would let in every Google account there is. With no password, sessions are signed with the random key in `session-secret` or an `APP_SECRET` of at least 32 bytes, and never with one derived from nothing: nothing else secret goes into a session's signature then, so a key a person chose could be guessed offline from one cookie and used to sign sessions that *Sign out everywhere* cannot end. Where neither can be had, nobody can sign in and the log says why. Changing who may sign in ends every session, the password's included, as changing the password does (and so does turning sign-in with Google on or off). Google tells the app the account's id and, when it is verified, its address; the app compares them with the list and stores neither for an account it lets in — the session cookie names no one — and writes only an id to the log: of an account it turned away, or of one it let in by its address alone. Sign-in with Google works at `APP_URL` alone: Google returns only there and its cookie is `Secure`, so it needs https (or this machine), and the login page's button goes there from any other name the app answers to; a plain-http home address keeps the password. `APP_URL` and `APP_BASE_URL` (below) are normally the same https address, set twice for two jobs: `APP_BASE_URL`, which both apps read under that one name, tells the app which requests arrived over https (it can stay unset where a trusted proxy says so in `X-Forwarded-Proto`), while `APP_URL` is where Google sends the browser back, so it is the site's root and each app has its own (`SKINS_APP_URL` for skins).

> Even with a password, this is a single-user app holding one shared collection. It is meant for your own machine or private network, not for running a service for other people.

**Behind a proxy.** The login limiter and the per-route limits count attempts per client. Without a proxy every client is one client, and the `X-Forwarded-For` header is ignored — anyone can send one. Set `TRUST_PROXY=1` only when a reverse proxy in front of the app sets that header, and it will be read — as will `X-Forwarded-Proto`, which is what lets the session cookie be marked `Secure` and the response carry HSTS when the proxy terminates TLS. Without it, `X-Forwarded-Proto` is believed nowhere: Next writes `https` into the address of any request whose header so much as contains it, from anyone, so the apps read neither. Both are read from the right: proxies append to these headers, so the rightmost entry is what your proxy saw and anything left of it is whatever the client typed; behind more than one proxy, `TRUSTED_PROXY_HOPS` says how many. `COOKIE_SECURE=1` (or `0`) settles the cookie's `Secure` flag outright, for a proxy the app cannot be told about. Compose binds both apps to `127.0.0.1`; put the proxy in front and change the bind address there, since neither app speaks TLS.

**Host names and other sites.** Whether or not a password is set, each app answers only to the names it expects — localhost, an IP address, a single-label machine name, or a `.local` / `.lan` / `.internal` / `.home.arpa` name — so a hostile page cannot point a DNS name of its own at your instance and read the collection. Reaching it by a domain name (through a reverse proxy, say) needs `ALLOWED_HOSTS=cards.example.com`, and the proxy has to pass the original `Host` header through. The list replaces those defaults rather than adding to them, so name every way the instance is still reached (`ALLOWED_HOSTS=cards.example.com,192.168.1.20,cardbox.local`); `*` turns the check off. The health route ignores the list, since a container checks itself by address. Requests that a browser sends from anywhere but the app's own origin are refused for anything but a read, so a page you happen to visit cannot restore a backup over your collection or spend your API budget: `Sec-Fetch-Site` must say `same-origin`, and an `Origin` must match scheme, name and port. Behind a proxy that ends TLS, tell the app so — `TRUST_PROXY=1` with `X-Forwarded-Proto`, `APP_BASE_URL=https://…` or `COOKIE_SECURE=1` — or every write from the browser is refused as coming from another origin. `APP_BASE_URL` speaks for the address it names alone, name and port as the proxy passes them in `Host`: the LAN address or name listed beside the domain is reached over plain http, since neither app serves TLS, and keeps working that way. `COOKIE_SECURE=1` says every page is https, so it is for an instance reached only through the proxy. `curl` and scripts, which send no browser origin headers, are unaffected, but a body sent to the JSON API must say `Content-Type: application/json` (a `text/plain` form is something any page can send without asking, and its bytes can parse as JSON), or it is answered 415; a write with neither a body nor a `Content-Type`, such as a `DELETE` or a price refresh from a script, needs no header, and uploads, restores and folder imports stay `multipart/form-data`.

**Webhooks.** The alert webhook is posted to by the server itself, so it has to be an address on the public internet: `localhost`, `*.local`, and any private, loopback, link-local or reserved address (carrier-grade NAT, benchmarking, multicast and the like) are refused when saved, a name that resolves to one is refused at delivery, and the request does not follow redirects. The name is resolved once, inside the connection itself, and every address it answers with is checked before the one connected to is used, so a DNS answer that changes between a check and the request cannot point the post at your own network; each delivery opens a connection of its own, and an address carrying a user name or password is refused.

**What every response carries** is in [The website](#the-website) below. `GET /api/health` answers without a session — `{ ok, app, version, database, scheduler: { enabled, running, lastRunAt } }`, and nothing more, since it answers anyone — for a container health check or a proxy. `database` is true only when a query has just run through the live connection: a database file whose restore journal cannot be replayed reports false, with the reason in the log rather than the response, and an install with no database yet reports false without one being created. `ok` means the process answers.

**Limits on the expensive routes.** Identifying a photo (10 a minute), uploading (30), refreshing every price (6), pricing one card (120, since a scan or a bulk refresh sends one per card), reading a folder or a Steam inventory back in (6), importing a spreadsheet (30), downloading a backup or the folder (6), and restoring a backup or putting one back (6) each refuse with a 429 and a `Retry-After` past their limit. They are in memory and per process — protection against a runaway client or a double-clicked button, not a public API's defence. No request body is accepted past 64 MB: each app's proxy makes Next buffer every body, and past its buffer Next would hand a route a body cut short rather than refuse it, so the buffer is set to that and every route's ceiling sits under it. Only one whole-collection price refresh runs at a time, whoever asks: a second is told so with a 409, since the answer it wants is already being produced.

### The website

Each app is its own website: the pages are the interface, and the Node server
behind them does everything else — it answers every request with the headers
below, refuses what is not part of the site, draws the not-found page and keeps
the collection. There is no static export and nothing to configure on a web
server: the app sets its headers itself (`packages/core/src/proxy.ts`, which
runs for every path, Next's own files and the not-found page included), so a
reverse proxy in front should pass them through and add no policy of its own —
two policies on one response are both enforced, and the stricter wins wherever
they differ. Each app lives at the root of its own origin (its cookies, service
worker and links all assume `/`), so give each one its own host name or port
rather than a path on a shared one.

These are the headers each app sends on every response when it is served over
https. Over plain http (the default on a home network) the same, less
`Strict-Transport-Security` and `upgrade-insecure-requests`, which would send
every script and stylesheet to an https port nothing listens on. Which one a
response is decided request by request (`servedOverHttps` in
`packages/core/src/net.ts`): https when a trusted proxy says the request came
over TLS, or when it was sent to the https address `APP_BASE_URL` names, and
plain http for every other name the instance answers to, such as the LAN address
kept beside a domain. `{nonce}` is
16 random bytes, fresh for every response. Both blocks are read by the tests:
each app's `tests/website.test.ts` holds its proxy's output equal to its block
word for word, and its browser suite holds every live response to it.

Redirects and refusals carry them too. An address with a trailing slash is
redirected to the one without by the proxy itself: Next's own redirect, made
before the proxy runs, left with none of them, so each app's `next.config.ts`
turns it off (`skipTrailingSlashRedirect`). Two answers still leave without
them, because Next makes them before the proxy runs, and neither is something
a browser draws: the redirect from an address with a repeated slash or a
backslash (`//collection`) to the one without, and the 500 for a `TRACE`
request — a method no page can make a browser send — for which Next cannot
build the request the proxy reads. Before Next, Node's own HTTP parser answers
two more with no header at all and an empty body: a 400 for a method it does not
know (`FOO`, `TRACK`), which no page can make a browser send either, and a 431
for a request whose headers are past its limit, which a page could provoke by
filling this origin's cookies. The browser suite pins all four, so a Next or a
Node that changes one fails it.

The card app:

<!-- headers:cards:begin -->
```text
Content-Security-Policy: default-src 'none'; script-src 'self' 'nonce-{nonce}' 'strict-dynamic'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' blob: https:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), autoplay=(), browsing-topics=(), camera=(self), clipboard-read=(), clipboard-write=(), display-capture=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), interest-cohort=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), window-management=(), xr-spatial-tracking=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
```
<!-- headers:cards:end -->

The skins app:

<!-- headers:skins:begin -->
```text
Content-Security-Policy: default-src 'none'; script-src 'self' 'nonce-{nonce}' 'strict-dynamic'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' https://community.cloudflare.steamstatic.com https://steamcommunity-a.akamaihd.net; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), autoplay=(), browsing-topics=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), interest-cohort=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), window-management=(), xr-spatial-tracking=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
```
<!-- headers:skins:end -->

Every source in the policy was measured, by driving each app's production build
in Chromium under exactly this header (`npm run test:e2e`: every spec fails on a
policy violation, a page error or a request that leaves the site, and
`e2e/website.spec.ts` drives the main flow, starts every page the app has and
checks the headers of every response), not copied from anywhere: taken out, each
one turns a spec red, but `script-src`'s `'self'`, which only a browser that
predates `'strict-dynamic'` reads, and `worker-src`, which Chromium fills from
`script-src` when it is missing — it is stated so the policy names where the
service worker comes from, and set to `'none'` it refuses the worker on every
page. The refusals are checked the other way round:
the suite serves a page under the real policy carrying an inline script, one of
the site's own scripts without the nonce, a `<style>`, a `<base>`, an outside
image, an `<object>`, a frame, a fetch elsewhere and a form posting elsewhere,
and requires each to be refused by the directive meant to refuse it, and frames
a page from another origin to see it refused.

| Directive | Why |
| --- | --- |
| `default-src 'none'` | Nothing loads unless it is named below. |
| `script-src` | This origin's files, and an inline script only with this response's nonce: Next stamps it on its bootstrap and page data, the layout on the theme script and the safety net. `'strict-dynamic'` lets those load Next's chunks and makes a modern browser ignore `'self'`, so markup injected into a page cannot load even one of this origin's own files. No `'unsafe-inline'`, and `'unsafe-eval'` only under `next dev`. |
| `style-src 'self'`, `style-src-attr 'unsafe-inline'` | The app's own stylesheets, and `style` attributes, which React writes for the theme's variables, the charts and each card's colour. An injected `<style>` element is refused. `next dev` adds `'unsafe-inline'` for its overlay. |
| `img-src` | Both: the app's icons and uploaded photos (this origin). Cards: a photo's preview while it uploads (`blob:`), and reference images from whichever price source matched (`https:`); a reference image whose address is `http:` or carries credentials, from a file, a spreadsheet or a restore, is kept on the card but not drawn (`shownImage` in `src/lib/format.ts`). Skins: Steam's two image hosts, and a page draws an item's picture from those alone (`src/lib/images.ts`): one whose address names another host, from a spreadsheet's image column say, keeps it but shows "No image" rather than ask for a picture the policy refuses. No `data:`: nothing uses one. |
| `font-src`, `connect-src`, `worker-src`, `manifest-src` | The display face, the app's own API, its service worker and its manifest — all this origin. A browser reads the manifest only when something asks for it, installing the app say, so the suite asks for it the way an install does. `next dev` adds its websocket. |
| `form-action 'self'` | The collection and inventory search boxes are plain forms that reload their own page, so they work before the scripts arrive. |
| media | None: the scan screen's camera preview is a stream handed to `<video>` as an object, which no fetch directive governs. |
| `frame-ancestors 'none'`, `X-Frame-Options: DENY` | Nothing here is meant to be framed; Settings has one-click buttons (sign out everywhere) that a framing page would like to steer. |
| `upgrade-insecure-requests` | Only over https, as above. |

Measured and not adopted: `require-trusted-types-for 'script'`. Next's chunk
loader assigns script URLs as strings, so under it every navigation to a page
whose code had not loaded yet threw and fell back to a full page load, the
not-found page threw while drawing, and the service worker, registered from a
string, was refused — the app could neither install nor open offline.

`Permissions-Policy` denies every feature Chromium knows that a page could
reach for, but the camera on the card app's scan screen; the browser suite reads
`document.featurePolicy` back and fails on a name Chromium does not recognise (a
misspelt feature is ignored without a word) or a feature the page still has.
`Referrer-Policy: no-referrer` because a page's address names a card or an item.
`Cross-Origin-Resource-Policy: same-origin`: no other site may embed a photo, a
chart or a script from here. `Strict-Transport-Security` (a year,
`includeSubDomains`) goes out when a trusted proxy says the request came over
TLS, or when it was sent to the https address `APP_BASE_URL` names;
`includeSubDomains` holds every name under that host to https too, so give the
app a leaf name or a host whose subdomains are all https. No `X-Powered-By`.
Next's image optimiser (`/_next/image`, which neither app uses) sets a stricter
policy of its own on what it answers.

**Caching**, as measured: every page, and every API answer but an uploaded
photo, is `no-store` (the collection, what it cost and what it is worth never go
to the browser's disk); a photo is `private, max-age=31536000, immutable`, since
its name never changes, and the photo route's 404 and 400 are `no-store` like
the rest; Next's content-hashed build files are `public,
max-age=31536000, immutable`; `/sw.js` and `/guard.js` are `no-cache`, and the
manifest, the icons, `robots.txt` and `security.txt` `max-age=0` — revalidated on
every use, because their names carry no version.

**A safety net.** Every page loads `/guard.js` (`packages/core/src/guard.ts`)
before the app: when the page's scripts fail to arrive or throw before React has
taken the page over, a note at the top says the page did not finish loading and
offers Reload, instead of buttons that silently do nothing. Without JavaScript
at all, a `<noscript>` note says what still works: the pages read, links and the
search boxes work, and nothing can be added or changed.

**For robots and for reports.** `/robots.txt` asks every crawler to stay out —
this is one owner's collection — and `/.well-known/security.txt` points at
GitHub's private vulnerability reporting and, for while that is switched off,
at the issues page, for an issue that says only that there is a report, as
`SECURITY.md` does; its `Policy` is `SECURITY.md` on `main`. Both answer
without a session, as do Next's build files and `/guard.js`, which the login
page needs. `security.txt` expires on 2027-10-08, and each app's
`tests/website.test.ts` fails once it has: renew it, a year ahead at most.

**Nothing else is served.** The repository's own files — `README.md`,
`package.json`, `.env`, `.git/`, the sources, the data directory — answer 404:
only routes and each app's `public/` folder are reachable, which the browser
suite checks address by address.

## Development

```bash
npm run dev               # the card app's development server (npm run skins for the other)
npm run check             # lint, typecheck, unit tests and the conventions test: the gate before a push
npm run build             # production build of every workspace
npm start                 # the card app from its build; npm run start:skins for the other
npm test                  # unit tests (vitest), every workspace
npm run test:e2e          # builds both apps, then both end-to-end suites (playwright; each boots its own servers and cleans up after)
npm run test:all          # unit tests, then the end-to-end suites
npm run test:conventions  # the repository's shape against CONVENTIONS.md
npm run typecheck         # tsc in every workspace, after generating Next route types
npm run lint              # eslint in every workspace, the shared package included
```

`npm run e2e` is kept as another name for `npm run test:e2e`, which builds first.

Every script above runs from the repository root and covers every workspace.
To drive one app on its own, add `-w @collectcollect/cards` — which is how you
reach the app-only scripts, such as `npm run e2e:ui -w @collectcollect/cards`
for the Playwright suite in UI mode, or `npm run icons -w @collectcollect/skins`
to re-render that app's icons from its SVG.

Node 22 or later; `.nvmrc` says so for version managers and `engines` for npm,
which warns under an older one. `CONTRIBUTING.md` has the checks a change is
expected to pass. CI runs on every push, on pull requests, by hand and weekly:
one `check` job runs lint, typecheck, the unit tests, the conventions test,
both builds and both end-to-end suites; a `docker` job builds both images,
boots each and asks it how it is; and an `audit` job runs the shared gate,
`node .github/audit/npm-audit.mjs`: `npm audit --omit=dev` against the
lockfile, red on every high or critical advisory that
`.github/audit/accepted.json` does not accept (this repository keeps no such
list, so it accepts none). Every job runs on Ubuntu 24.04 by name rather than
`ubuntu-latest`, since the locked Playwright has no Chromium build for the
26.04 that label becomes (a unit test asks Playwright which releases it has
one for, so raising Playwright is the way to a newer runner), and every action
is pinned to a commit of a release that runs on Node 24.

Unit tests cover the pieces where a mistake is silent: price matching and the
provider adapters (against recorded responses, never the network), the
valuation and grading-outlook maths, the repository and its migrations, sales,
submissions, alert rules, and the gate: the password, and sign-in with Google
against a fake Google (`scripts/fake-google.mjs`: its own RSA key, token
endpoint and consent screen) handed to the routes in place of `fetch`, with
the kit's own self-test (`packages/core/src/kit/selftest.mjs`) run by
`npm test`.

The end-to-end suite drives a real production build in Chromium against a
throwaway data directory. Identification is intercepted in the browser, and the
servers under test are started with no network at all (`scripts/e2e-offline.mjs`),
so a price lookup made on the server fails at once and says so; the tests never
call Anthropic or a price API, but everything else, including the database,
runs for real. It covers adding a card by hand, duplicate
merging, scan mode's add/merge/set-aside behaviour, a sale and its undo, a
grading submission from draft to booked outcome, and the gate: the password,
sign-in with Google beside it (cards) and on its own (skins). Google's half of
a sign-in is played the same way: its sign-in page by the test, answered at the
protocol with a redirect back to the app, and its token endpoint and keys by
the fake that `scripts/e2e-google.mjs` puts in front of the server's `fetch`.
Every spec imports its `test` from `e2e/fixtures.ts` (each app's
`tests/website.test.ts` fails on one that does not), so any page a test drives,
in a browser context of the test's own making too, fails it on a content
security policy violation, an uncaught exception or a request that leaves the
site (but the one navigation to Google's sign-in page, which the test answers
itself); only `unwatchedContext` makes a context outside those rules, for the two
tests whose pages break them on purpose. `e2e/website.spec.ts` drives each app's
main flow and starts every page it has, holding every response to the README's
headers (see [The website](#the-website)).

The type checker runs strict, with `noUncheckedIndexedAccess` on in every
workspace: an element read out of an array or a table is `undefined` until the
code has said what happens when it is not there. Every such read is narrowed
rather than asserted — a `!` that turned out to be wrong is exactly the kind
of silent wrong number this app exists to avoid.

## Project layout

The repository is an npm workspace, so a second collectible can get its own app
without either one inheriting the other's assumptions. Root scripts fan out
across all of them.

```
apps/cards/              this app
apps/skins/              the same idea for CS2 items — see its own section below
packages/core/           code with no opinion about what is being collected
```

Inside `packages/core/src`:

```
markdown/                The Markdown codec: front matter, tables, money, slugs
zip.ts, csv.ts           Dependency-free streaming zip writer and reader; RFC 4180 CSV reader
auth.ts, auth-route.ts   The optional gate (a password, Google or both), its sign-in routes, and revoking a session
google-config.ts         Sign-in with Google: each app's variables, who may sign in, where to return
google-signin.ts         Its two routes: leaving for Google, and coming back through the kit's checks
kit/                     The shared sign-in kit, copied byte for byte and never edited here; this
                         repository uses google.js, crypto.js and http.js (see CLAUDE.md)
sessions.ts              Ended sessions, kept in one small file beside the data
proxy.ts                 The per-request gate: request-guard.ts, session check, CSP nonce, security headers
forwarded.ts             Which X-Forwarded-* entry may be believed: the one a trusted proxy wrote
limits.ts                The largest request body either app accepts, and the proxy buffer set from it
restore-validation.ts    What a restored database may carry: no foreign triggers or views, the app's own indexes
request-guard.ts         The host list, the cross-site write check and the JSON rule, ahead of the password
net.ts, http.ts          What may be a webhook, whether a request came over TLS; route helpers
webhook.ts               Resolves a webhook's host inside the connection that posts to it
public-request.ts        One HTTP(S) exchange through a given DNS lookup, no pool and no redirects
throttle.ts, limiter.ts  Per-route request ceilings; per-source pacing for the price APIs
gate.ts                  One-at-a-time for a refresh, a backup or a restore
scheduler.ts             The hourly auto-refresh, one instance per app
collection-swap.ts       Moving a database aside and another into place without a gap
atomic-write.ts          Write-then-rename with fsync, for every file the mirror writes
lookup.ts, series.ts     Prototype-safe table lookup; extent and thinning for long series
appearance.ts            Light, dark or system and the palette: stored, applied, kept in step across tabs
family-theme.css         The eight palettes' grounds, panels and accents, and the header's palette menu
manifest.ts, service-worker.ts
                         The installable app shell both apps share; each app only names itself
guard.ts                 The safety net every page loads first, served at /guard.js
charts/, components/     Chart geometry and the components both apps draw with, including the
                         not-found, error and offline pages, the service worker registration,
                         the safety net's Started signal and the no-JavaScript note
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
  api/backup             GET — the database and photos as one zip; /restore puts one back;
                         /replaced lists what restores moved aside and POST puts one back
  api/cards/[id]/acquisitions
                         GET/POST — what each copy cost; POST records another purchase
  api/cards/[id]/cert    POST — fill a card from PSA's record of its cert number
  api/collection         GET — the collection as Markdown; /rebuild rewrites it, /import reads it back
  api/import             POST — preview a CSV, or apply it with `apply: true`
  api/locations          GET — storage locations in use, for autocomplete
  api/sets/refresh       POST — fetch and store a set's published checklist
  api/auth               POST signs in, DELETE signs out this session; /revoke ends every
                         session at once (only when the gate is on); /google/start and
                         /google/callback sign in with Google (404 unless it is set up)
  api/health             GET — is the server up, which version, what is it reading; needs no session
  api/settings           Multipliers + provider status
src/lib/identify/        Claude vision call and the identification schema
src/lib/grading/         Agency report links, centering limits and the PSA cert client
src/lib/pricing/         Providers, matching heuristics, summary/valuation, refresh pipeline
src/lib/analytics.ts     Portfolio value over time (holdings, flows, cost basis), grading outlook and timing verdict
src/lib/scheduler.ts     Hourly auto-refresh of stale prices (started from src/instrumentation.ts)
src/lib/uploads.ts       The daily sweep of uploaded photos nothing points at
src/lib/version.ts       The version the About section and the health route report
src/lib/name-key.ts      The normalised name duplicate detection looks a card up by
src/components/charts/   Inline-SVG portfolio line and min/max outlook band charts
src/lib/acquisitions.ts  Purchase lots: what each copy cost, consumed oldest first on a sale
src/lib/markdown/        The plain-text copy: format, one card as a document, the
                         on-disk mirror, and reading a collection back out of it
src/lib/import.ts        Maps a spreadsheet's columns to cards, previews, then applies in one transaction
src/lib/backup.ts        The zip of everything, and the restore that swaps it in
src/lib/sets/            Set checklist providers, caching and completion matching
src/lib/auth.ts          This app's cookie names and variables for the shared gate
src/proxy.ts             Runs for every path: the security headers, the host and cross-site
                         checks, and the gate when APP_PASSWORD or a GOOGLE_ variable is set
public/                  robots.txt, .well-known/security.txt and the icons
e2e/                     Playwright suite driving a real build; fixtures.ts holds every spec
                         to the policy, website.spec.ts drives the site and its headers
src/lib/cards.ts, db.ts  SQLite (better-sqlite3) repository and schema
src/components/          UI (add flow, card detail, price panel, settings)
tests/                   Vitest suites (providers with mocked fetch, valuation, repository)
```

## License

MIT — see [LICENSE](LICENSE). The display font is bundled under its own licence, the SIL Open Font License, in `packages/core/fonts/OFL.txt`.
