import { afterEach, describe, expect, it } from "vitest";
import { fakeFetch } from "./helpers";
import { buildQuery, pickVariantKey, pokemonTcgProvider } from "@/lib/pricing/providers/pokemontcg";
import { ygoprodeckProvider } from "@/lib/pricing/providers/ygoprodeck";
import { scryfallProvider } from "@/lib/pricing/providers/scryfall";
import { buildSearch, priceChartingProvider, productToQuote, scoreProduct } from "@/lib/pricing/providers/pricecharting";
import { cardToQuery } from "@/lib/pricing/index";

describe("Pokémon TCG provider", () => {
  it("builds a name+number query", () => {
    expect(buildQuery({ game: "pokemon", name: "Charizard", cardNumber: "4/102" })).toBe('name:"Charizard" number:4');
  });
  it("prefers the variant matching the card", () => {
    expect(pickVariantKey("reverse holo", ["normal", "reverseHolofoil"])).toBe("reverseHolofoil");
    expect(pickVariantKey("1st edition holo", ["holofoil", "1stEditionHolofoil"])).toBe("1stEditionHolofoil");
    expect(pickVariantKey(null, ["holofoil"])).toBe("holofoil");
  });
  it("picks the best set match and returns TCGplayer + Cardmarket quotes", async () => {
    const fetchImpl = fakeFetch([
      [
        "api.pokemontcg.io/v2/cards?q=",
        {
          data: [
            {
              id: "base4-4",
              name: "Charizard",
              number: "4",
              rarity: "Rare Holo",
              set: { id: "base4", name: "Base Set 2", releaseDate: "2000/02/24" },
              tcgplayer: { url: "https://tcgplayer.example/base2", prices: { holofoil: { market: 250 } } },
            },
            {
              id: "base1-4",
              name: "Charizard",
              number: "4",
              rarity: "Rare Holo",
              set: { id: "base1", name: "Base", series: "Base", releaseDate: "1999/01/09" },
              images: { large: "https://img.example/base1-4.png" },
              tcgplayer: { url: "https://tcgplayer.example/base1", prices: { holofoil: { market: 400 }, "1stEditionHolofoil": { market: 5000 } } },
              cardmarket: { url: "https://cardmarket.example", prices: { trendPrice: 380.5, avg30: 370 } },
            },
          ],
        },
      ],
    ]);
    const quotes = await pokemonTcgProvider.lookup(
      { game: "pokemon", name: "Charizard", cardNumber: "4/102", setName: "Base Set", year: 1999, variant: "holo" },
      fetchImpl,
    );
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ source: "pokemontcg", currency: "USD", ungraded: 400, externalId: "base1-4", referenceImageUrl: "https://img.example/base1-4.png" });
    expect(quotes[0].ungradedVariants).toEqual({ Holofoil: 400, "1st Edition Holofoil": 5000 });
    expect(quotes[1]).toMatchObject({ currency: "EUR", ungraded: 380.5 });
  });
  it("falls back to searching when a stored id answers with nothing", async () => {
    // A 200 with no `data` used to put `undefined` straight into the results.
    const fetchImpl = fakeFetch([
      ["v2/cards/base1-4", {}],
      [
        "api.pokemontcg.io/v2/cards?q=",
        { data: [{ id: "base1-4", name: "Charizard", number: "4", set: { id: "base1", name: "Base" }, tcgplayer: { prices: { holofoil: { market: 415 } } } }] },
      ],
    ]);
    const quotes = await pokemonTcgProvider.lookup(
      { game: "pokemon", name: "Charizard", externalIds: { pokemontcg: "base1-4" } },
      fetchImpl,
    );
    expect(quotes[0].ungraded).toBe(415);
  });
  it("uses a stored id directly", async () => {
    const fetchImpl = fakeFetch([
      ["v2/cards/base1-4", { data: { id: "base1-4", name: "Charizard", number: "4", set: { id: "base1", name: "Base" }, tcgplayer: { prices: { holofoil: { market: 410 } } } } }],
    ]);
    const quotes = await pokemonTcgProvider.lookup({ game: "pokemon", name: "Charizard", externalIds: { pokemontcg: "base1-4" } }, fetchImpl);
    expect(quotes[0].ungraded).toBe(410);
  });
  it("returns nothing when there is no match", async () => {
    const quotes = await pokemonTcgProvider.lookup({ game: "pokemon", name: "Nope" }, fakeFetch([["v2/cards?q=", { data: [] }]]));
    expect(quotes).toEqual([]);
  });
});

describe("YGOPRODeck provider", () => {
  it("uses the set-specific price when the set code matches", async () => {
    const fetchImpl = fakeFetch([
      [
        "cardinfo.php?name=",
        {
          data: [
            {
              id: 46986414,
              name: "Dark Magician",
              type: "Normal Monster",
              card_sets: [
                { set_name: "Legend of Blue Eyes White Dragon", set_code: "LOB-005", set_rarity: "Ultra Rare", set_price: "120.00" },
                { set_name: "Starter Deck: Yugi", set_code: "SDY-006", set_rarity: "Ultra Rare", set_price: "15.00" },
              ],
              card_images: [{ image_url: "https://img.example/dm.jpg" }],
              card_prices: [{ cardmarket_price: "3.50", tcgplayer_price: "4.20", ebay_price: "9.99", amazon_price: "0.00" }],
              ygoprodeck_url: "https://ygoprodeck.com/card/dark-magician",
            },
          ],
        },
      ],
    ]);
    const quotes = await ygoprodeckProvider.lookup({ game: "yugioh", name: "Dark Magician", setCode: "LOB-005" }, fetchImpl);
    expect(quotes[0]).toMatchObject({ source: "ygoprodeck", ungraded: 120, matchedDetail: "Legend of Blue Eyes White Dragon · LOB-005 · Ultra Rare" });
    expect(quotes[0].ungradedVariants).toMatchObject({ TCGplayer: 4.2, eBay: 9.99, "This set (LOB-005)": 120 });
    expect(quotes[0].ungradedVariants).not.toHaveProperty("Amazon");
    expect(quotes[1]).toMatchObject({ currency: "EUR", ungraded: 3.5 });
  });
  it("falls back to fuzzy search and treats 400 as no match", async () => {
    const fetchImpl = fakeFetch([
      ["cardinfo.php?name=", { error: "No card matching your query was found" }, 400],
      ["cardinfo.php?fname=", { error: "No card matching your query was found" }, 400],
    ]);
    expect(await ygoprodeckProvider.lookup({ game: "yugioh", name: "Nothing" }, fetchImpl)).toEqual([]);
  });
});

describe("Scryfall provider", () => {
  it("looks up by set + collector number and picks foil pricing for foil cards", async () => {
    const fetchImpl = fakeFetch([
      [
        "api.scryfall.com/cards/mh2/151",
        { id: "abc", name: "Ragavan, Nimble Pilferer", set: "mh2", set_name: "Modern Horizons 2", collector_number: "138", rarity: "mythic", scryfall_uri: "https://scryfall.com/x", prices: { usd: "40.00", usd_foil: "55.00", eur: "35.00", eur_foil: "50.00" }, image_uris: { normal: "https://img.example/r.jpg" } },
      ],
    ]);
    const quotes = await scryfallProvider.lookup({ game: "mtg", name: "Ragavan", setCode: "MH2", cardNumber: "151", variant: "foil" }, fetchImpl);
    expect(quotes[0]).toMatchObject({ source: "scryfall", ungraded: 55, ungradedVariants: { "Non-foil": 40, Foil: 55 } });
    expect(quotes[1]).toMatchObject({ currency: "EUR", ungraded: 50 });
  });
  it("retries the fuzzy lookup without the set when the set-scoped lookup 404s", async () => {
    const fetchImpl = fakeFetch([
      [/cards\/named\?fuzzy=.*&set=/, { object: "error" }, 404],
      [/cards\/named\?fuzzy=/, { id: "x", name: "Black Lotus", set: "lea", set_name: "Limited Edition Alpha", collector_number: "232", prices: { usd: "100000" } }],
    ]);
    const quotes = await scryfallProvider.lookup({ game: "mtg", name: "Black Lotus", setCode: "zzz" }, fetchImpl);
    expect(quotes[0].ungraded).toBe(100000);
  });
});

describe("PriceCharting provider", () => {
  afterEach(() => {
    delete process.env.PRICECHARTING_TOKEN;
  });
  it("is skipped without a token", async () => {
    expect(priceChartingProvider.isConfigured()).toBe(false);
    expect(await priceChartingProvider.lookup({ game: "pokemon", name: "Charizard" })).toEqual([]);
  });
  it("builds sports and TCG searches differently", () => {
    expect(buildSearch({ game: "sports", name: "Mike Trout", year: 2011, manufacturer: "Topps", setName: "Topps Update", cardNumber: "US175" })).toBe("2011 Topps Update Mike Trout #US175");
    expect(buildSearch({ game: "pokemon", name: "Charizard", cardNumber: "4/102", setName: "Base Set" })).toBe("Charizard #4 Base Set");
  });
  it("maps the grade fields and cents to dollars", () => {
    const q = productToQuote({ id: "1", "product-name": "Charizard #4", "console-name": "Pokemon Base Set", "loose-price": 25000, "graded-price": 80000, "manual-only-price": 500000, "bgs-10-price": 2000000, "box-only-price": 150000 });
    expect(q.ungraded).toBe(250);
    expect(q.graded).toEqual({ "Grade 9": 800, "Grade 9.5": 1500, "PSA 10": 5000, "BGS 10": 20000 });
  });
  it("ranks the product whose number and set match", async () => {
    process.env.PRICECHARTING_TOKEN = "t";
    const products = [
      { id: "a", "product-name": "Charizard #4", "console-name": "Pokemon Base Set 2", "loose-price": 10000 },
      { id: "b", "product-name": "Charizard #4", "console-name": "Pokemon Base Set", "loose-price": 25000, "manual-only-price": 500000 },
      { id: "c", "product-name": "Charizard #11", "console-name": "Pokemon Base Set", "loose-price": 3000 },
    ];
    const q = { game: "pokemon" as const, name: "Charizard", cardNumber: "4/102", setName: "Base Set" };
    expect(scoreProduct(q, products[1])).toBeGreaterThan(scoreProduct(q, products[0]));
    expect(scoreProduct(q, products[1])).toBeGreaterThan(scoreProduct(q, products[2]));
    const quotes = await priceChartingProvider.lookup(q, fakeFetch([["api/products", { status: "success", products }]]));
    expect(quotes[0]).toMatchObject({ externalId: "b", ungraded: 250, graded: { "PSA 10": 5000 } });
  });
  it("goes straight to the product when an id is known", async () => {
    process.env.PRICECHARTING_TOKEN = "t";
    const fetchImpl = fakeFetch([["api/product?", { status: "success", id: "b", "product-name": "Charizard #4", "console-name": "Pokemon Base Set", "loose-price": 26000 }]]);
    const quotes = await priceChartingProvider.lookup({ game: "pokemon", name: "Charizard", externalIds: { pricecharting: "b" } }, fetchImpl);
    expect(quotes[0].ungraded).toBe(260);
  });
});

describe("which printing a Magic price is for", () => {
  it("says foil when the foil price is the only one there is", async () => {
    const card = {
      id: "abc",
      name: "Lightning Bolt",
      set: "2xm",
      set_name: "Double Masters",
      collector_number: "129",
      rarity: "uncommon",
      prices: { usd: null, usd_foil: "42.00" },
      scryfall_uri: "https://scryfall.example/bolt",
    };
    const fetchImpl = fakeFetch([["api.scryfall.com", card]]);
    // Asking for a non-foil copy, but only the foil has a price.
    const quotes = await scryfallProvider.lookup({ game: "mtg", name: "Lightning Bolt" }, fetchImpl);
    expect(quotes[0]).toMatchObject({ ungraded: 42, ungradedVariants: { Foil: 42 } });
    expect(quotes[0].matchedDetail).toContain("Foil");
    expect(quotes[0].matchedDetail).not.toContain("Non-foil");
  });

  it("prefers the printing that was asked for", async () => {
    const card = {
      id: "abc",
      name: "Lightning Bolt",
      set: "2xm",
      set_name: "Double Masters",
      collector_number: "129",
      prices: { usd: "3.00", usd_foil: "42.00" },
    };
    const fetchImpl = fakeFetch([["api.scryfall.com", card]]);
    const plain = await scryfallProvider.lookup({ game: "mtg", name: "Lightning Bolt" }, fetchImpl);
    expect(plain[0]).toMatchObject({ ungraded: 3 });
    expect(plain[0].matchedDetail).toContain("Non-foil");

    const foil = await scryfallProvider.lookup({ game: "mtg", name: "Lightning Bolt", variant: "foil" }, fetchImpl);
    expect(foil[0]).toMatchObject({ ungraded: 42 });
    expect(foil[0].matchedDetail).toContain("Foil");
  });
});


describe("sports card searches", () => {
  it("puts the parallel, the autograph and the relic into the PriceCharting search", () => {
    const query = cardToQuery({
      game: "sports",
      name: "Mike Trout",
      sport: "baseball",
      setName: "Topps Chrome",
      setCode: null,
      cardNumber: "US175",
      year: 2011,
      variant: null,
      manufacturer: "Topps",
      parallel: "Gold Refractor",
      autograph: true,
      relic: false,
      externalIds: {},
    });
    expect(query.parallel).toBe("Gold Refractor Auto");
    expect(buildSearch(query)).toBe("2011 Topps Chrome Mike Trout #US175 Gold Refractor Auto");
    // A base card without any of that searches as before.
    expect(cardToQuery({ game: "sports", name: "Mike Trout", sport: null, setName: null, setCode: null, cardNumber: null, year: null, variant: null, manufacturer: null, externalIds: {} }).parallel).toBeNull();
  });

  it("ranks the listing that names the parallel above the base card when the copy is one", () => {
    const base = { id: "1", "product-name": "Mike Trout #US175", "console-name": "2011 Topps Update", "loose-price": 5000 };
    const gold = { id: "2", "product-name": "Mike Trout #US175 [Gold Refractor]", "console-name": "2011 Topps Update", "loose-price": 90000 };
    const plain = { game: "sports", name: "Mike Trout", cardNumber: "US175", setName: "Topps Update", year: 2011 } as const;
    expect(scoreProduct(plain, base)).toBeGreaterThan(scoreProduct(plain, gold));
    const withParallel = { ...plain, parallel: "Gold Refractor" };
    expect(scoreProduct(withParallel, gold)).toBeGreaterThan(scoreProduct(withParallel, base));
  });
});
