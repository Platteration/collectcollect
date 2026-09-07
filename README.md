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

Production: `npm run build && npm start`. Everything is stored locally in `./data` (SQLite database plus uploaded photos); set `DATA_DIR` to move it.

Docker: `docker compose up --build` (reads `.env`, keeps data in a named volume at `/data`).

> **No login.** CollectCollect is a single-user app with no authentication: anyone who can reach the port can see your collection, upload photos, and spend your Anthropic credits on identifications. Run it on your own machine or behind something that adds a login (Tailscale, a reverse proxy with basic auth, and so on). Do not expose it directly to the internet.

## How pricing works

| Source | Games | Key | What it provides |
| --- | --- | --- | --- |
| [PriceCharting](https://www.pricecharting.com/api-documentation) | all | `PRICECHARTING_TOKEN` (paid) | Ungraded **and graded** prices (PSA 10, Grade 9/9.5, BGS 10, CGC 10, SGC 10) |
| [Pokémon TCG API](https://pokemontcg.io) | Pokémon | optional `POKEMONTCG_API_KEY` | TCGplayer market price per printing (normal / holo / reverse / 1st ed.), Cardmarket EUR |
| [Scryfall](https://scryfall.com/docs/api) | Magic | none | USD / EUR, foil and non-foil |
| [YGOPRODeck](https://ygoprodeck.com/api-guide/) | Yu-Gi-Oh! | none | TCGplayer, eBay, Cardmarket, per-set price |
| Manual entry | all | — | Your own ungraded / graded prices, which override everything else |

For each card the app shows:

- **Ungraded (raw NM)** market price and where it came from.
- **Graded copies**: real graded prices when a source has them (PriceCharting or your manual entry). Grades with no real data are shown as **estimates** (`est.`) computed as *ungraded price × multiplier*; the multipliers live in Settings and default to conservative round numbers, so tune them per your experience.
- **Your copy**: the value of the specific copy you own. A PSA 9 uses the PSA 9 / Grade 9 price; a raw Lightly Played copy uses the ungraded price × the LP condition multiplier.

Every refresh stores a snapshot, so a card's detail page shows how its price has moved and the portfolio chart fills in. A refresh that returns no price (source down, no source configured for that game, no match) is reported but never stored over a card's last known value.

**Keeping history flowing.** The server re-prices any card whose latest snapshot is older than `AUTO_REFRESH_HOURS` (default 24, set 0 to disable) once an hour while it is running, and the Portfolio page has a *Refresh all prices* button. The min/max curves need a few refreshes before the timing verdict says anything stronger than "not enough history yet".

**Grading plans.** Each raw card carries a plan: undecided, plan to grade, at the grader, or keeping raw. A card is flagged **Ready** when the timing verdict is good and its upside after the fee clears the thresholds in Settings (default $40 and 50% of the raw price). The portfolio page counts ready cards, totals their upside, and lets you filter by plan; when a card comes back from the grader, edit it and enter the grade.

**Duplicates.** Saving a card that matches one you already have (same game and name, with the same number or set) offers to add it as another copy instead.

**Grading outlook math.** *max* is the PSA 10 price (real if a source reports it, otherwise ungraded × the PSA 10 multiplier); *min* is the PSA 8 / Grade 8 price on the same basis, falling back to the raw price; *upside* is max − raw − grading fee (Settings). "Good time to grade" means today's upside is within 10% of the highest upside in the card's history and positive.

Sports cards have no free price API; without a PriceCharting token you can still enter prices manually.

**Sales.** Log a sale from a card's page: copies leave the collection, the cost basis is captured at sale time so later edits don't rewrite history, and the portfolio shows realized gains (proceeds less fees less cost) beside unrealized ones. A sale can be undone, which puts the copies back. Fully sold cards stay in the collection greyed out with a "Sold" badge so their history survives.

**Appraisal report.** `/report` is a printable valuation of everything you own, with photos, identifications, grades, per-copy and total values, and the source and date behind each price. Print to PDF from the browser. Set the owner name in Settings.

**Export.** The Collection page has an *Export CSV* button (also `GET /api/export`) with every card, its grade or condition, purchase price, and latest ungraded / PSA 10 / your-copy prices.

## Card identification

Identification runs on Claude (`claude-opus-5` by default; override with `CLAUDE_MODEL`). Photos are downscaled server-side before being sent. The model returns a structured identification with a confidence score and alternative matches when the card is ambiguous; you can add a back or slab-label photo, give it a hint ("it's Japanese"), and re-identify. Without an Anthropic key the app still works for manual entry and pricing.

## Look and feel

Graded cards render in a slab frame with the grading company's label colour, so a PSA 9 in the grid reads as a slab rather than a photo. Each uploaded photo's average colour is sampled at save time and tints that card's tile and page. The hero value and card names use a condensed display face. Everything is theme-aware; dark mode is a designed palette, not an inverted one.

## Project layout

```
src/app/                 Next.js App Router pages and API routes
  /                      Portfolio: hero value, change, value chart, grading outlook
  /collection            Card grid with search and game filter
  api/identify           POST — identify a card from uploaded photos
  api/uploads            POST photos / GET stored photo
  api/cards[/id]         CRUD; /price refreshes prices, /prices returns history
  api/prices/lookup      Price a not-yet-saved card
  api/prices/refresh     POST — refresh every card (?stale=24 limits to stale ones)
  api/export             GET — the collection as CSV (?type=sales for the sales ledger)
  api/cards/[id]/sales   GET / POST — a card's sales; POST removes the copies sold
  api/sales              GET all sales with realized totals; DELETE /api/sales/[id] undoes one
  api/settings           Multipliers + provider status
src/lib/identify/        Claude vision call and the identification schema
src/lib/pricing/         Providers, matching heuristics, summary/valuation, refresh pipeline
src/lib/analytics.ts     Portfolio value series, grading outlook (min/max/upside) and timing verdict
src/lib/scheduler.ts     Hourly auto-refresh of stale prices (started from src/instrumentation.ts)
src/components/charts/   Inline-SVG portfolio line and min/max outlook band charts
src/lib/cards.ts, db.ts  SQLite (better-sqlite3) repository and schema
src/components/          UI (add flow, card detail, price panel, settings)
tests/                   Vitest suites (providers with mocked fetch, valuation, repository)
```

## Scripts

```bash
npm run dev         # development server
npm run build       # production build
npm test            # unit tests
npm run typecheck   # tsc (after generating Next route types)
npm run lint
```
