# CollectCollect

A personal cataloging app for trading cards: Pokémon, Yu-Gi-Oh!, Magic: The Gathering, sports cards (baseball, basketball, football, hockey…) and anything else in a sleeve.

Snap a photo of a card and CollectCollect:

1. **Identifies it** with Claude's vision model: game, name, set, collector number, year, rarity, printing variant (holo, 1st edition, refractor, autograph…) and, if it's in a slab, the grading company, grade and cert number.
2. **Looks up the going rate** for an **ungraded (raw)** copy and for **graded** copies (PSA / BGS / CGC / SGC) from live price sources.
3. **Keeps it in your collection** with quantity, condition or grade, purchase price, notes and a price history, and totals up what your collection is worth.

## Quick start

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY (and optional price-source keys)
npm run dev               # http://localhost:3000
```

Production: `npm run build && npm start`. Everything is stored locally in `./data` (SQLite database plus uploaded photos); set `DATA_DIR` to move it.

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

Every refresh stores a snapshot, so a card's detail page shows how its price has moved.

Sports cards have no free price API; without a PriceCharting token you can still enter prices manually.

## Card identification

Identification runs on Claude (`claude-opus-5` by default; override with `CLAUDE_MODEL`). Photos are downscaled server-side before being sent. The model returns a structured identification with a confidence score and alternative matches when the card is ambiguous; you can add a back or slab-label photo, give it a hint ("it's Japanese"), and re-identify. Without an Anthropic key the app still works for manual entry and pricing.

## Project layout

```
src/app/                 Next.js App Router pages and API routes
  api/identify           POST — identify a card from uploaded photos
  api/uploads            POST photos / GET stored photo
  api/cards[/id]         CRUD; /price refreshes prices, /prices returns history
  api/prices/lookup      Price a not-yet-saved card
  api/settings           Multipliers + provider status
src/lib/identify/        Claude vision call and the identification schema
src/lib/pricing/         Providers, matching heuristics, and the summary/valuation logic
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
