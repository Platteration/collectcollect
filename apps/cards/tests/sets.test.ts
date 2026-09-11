import { beforeEach, describe, expect, it } from "vitest";
import { fakeFetch } from "./helpers";
import { magicSets, pokemonSets, yugiohSets } from "@/lib/sets/providers";
import { getChecklist, ownedFromChecklist, refreshChecklist, setDetail, setProgress } from "@/lib/sets";
import { createCard } from "@/lib/cards";
import { openDatabase, setDb } from "@/lib/db";
import type { Checklist } from "@/lib/sets/types";

const hint = (over = {}) => ({ game: "pokemon" as const, setName: null, setCode: null, externalIds: {}, ...over });

describe("checklist providers", () => {
  it("takes the Pokémon set id from a card id learned while pricing", async () => {
    const fetchImpl = fakeFetch([
      [
        "q=set.id:base1",
        {
          data: [
            { name: "Alakazam", number: "1", rarity: "Rare Holo", set: { name: "Base" }, images: { small: "https://img/1" } },
            { name: "Blastoise", number: "2", rarity: "Rare Holo", set: { name: "Base" } },
          ],
        },
      ],
    ]);
    const list = await pokemonSets.checklist(hint({ externalIds: { pokemontcg: "base1-4" }, setName: "Base Set" }), fetchImpl);
    expect(list).toMatchObject({ setId: "base1", cards: [{ number: "1", name: "Alakazam", imageUrl: "https://img/1" }, { number: "2", name: "Blastoise" }] });
  });

  it("looks a Pokémon set up by name, and will not settle for a partial match", async () => {
    const sets = [{ id: "base1", name: "Base" }, { id: "base2", name: "Base Set 2" }];
    const cards = { data: [{ name: "Alakazam", number: "1", set: { name: "Base" } }] };
    const found = await pokemonSets.checklist(hint({ setName: "Base" }), fakeFetch([["v2/sets?q=", { data: sets }], ["q=set.id:", cards]]));
    expect(found?.setId).toBe("base1");
    // Two candidates and no exact name: better to say nothing than guess.
    const ambiguous = await pokemonSets.checklist(hint({ setName: "Bas" }), fakeFetch([["v2/sets?q=", { data: sets }]]));
    expect(ambiguous).toBeNull();
    expect(await pokemonSets.checklist(hint({}), fakeFetch([]))).toBeNull();
  });

  it("follows Scryfall's paging for a Magic set", async () => {
    const fetchImpl = fakeFetch([
      ["api.scryfall.com/sets/mh2", { code: "mh2", name: "Modern Horizons 2" }],
      [
        /cards\/search\?q=set%3Amh2/,
        { data: [{ name: "Ragavan", collector_number: "138", rarity: "mythic" }], has_more: true, next_page: "https://api.scryfall.com/cards/search?page=2" },
      ],
      [/cards\/search\?page=2/, { data: [{ name: "Urza's Saga", collector_number: "259", rarity: "rare" }], has_more: false }],
    ]);
    const list = await magicSets.checklist(hint({ game: "mtg", setCode: "MH2" }), fetchImpl);
    expect(list).toMatchObject({ setId: "mh2", setName: "Modern Horizons 2" });
    expect(list?.cards.map((c) => c.number)).toEqual(["138", "259"]);
    expect(await magicSets.checklist(hint({ game: "mtg", setCode: "zzz" }), fakeFetch([["api.scryfall.com/sets/", {}, 404]]))).toBeNull();
  });

  it("keeps the printing from the requested Yu-Gi-Oh! set and sorts by code", async () => {
    const fetchImpl = fakeFetch([
      [
        "cardset=",
        {
          data: [
            { name: "Dark Magician", card_sets: [{ set_name: "Legend of Blue Eyes White Dragon", set_code: "LOB-005", set_rarity: "Ultra Rare" }, { set_name: "Starter Deck", set_code: "SDY-006" }] },
            { name: "Blue-Eyes White Dragon", card_sets: [{ set_name: "Legend of Blue Eyes White Dragon", set_code: "LOB-001", set_rarity: "Ultra Rare" }] },
          ],
        },
      ],
    ]);
    const list = await yugiohSets.checklist(hint({ game: "yugioh", setName: "Legend of Blue Eyes White Dragon" }), fetchImpl);
    expect(list?.cards.map((c) => `${c.number} ${c.name}`)).toEqual(["LOB-001 Blue-Eyes White Dragon", "LOB-005 Dark Magician"]);
    expect(list?.cards[1]?.rarity).toBe("Ultra Rare");
    expect(await yugiohSets.checklist(hint({ game: "yugioh", setName: "Nope" }), fakeFetch([["cardset=", {}, 400]]))).toBeNull();
  });
});

describe("matching a collection against a checklist", () => {
  const checklist: Checklist = {
    game: "pokemon",
    setId: "base1",
    setName: "Base",
    cards: [
      { number: "4", name: "Charizard", rarity: null, imageUrl: null },
      { number: "58", name: "Pikachu", rarity: null, imageUrl: null },
      { number: "102", name: "Water Energy", rarity: null, imageUrl: null },
    ],
  };

  beforeEach(() => setDb(openDatabase(":memory:")));

  it("matches on collector number however it is written, then on name", () => {
    const owned = [
      { name: "Charizard", cardNumber: "4/102" },
      { name: "pikachu", cardNumber: null },
    ].map((c) => createCard({ game: "pokemon", setName: "Base", ...c }));
    const have = ownedFromChecklist(checklist, owned);
    expect([...have].sort()).toEqual(["4", "58"]);
  });

  it("reports completion per set and only where a checklist exists", async () => {
    createCard({ game: "pokemon", name: "Charizard", setName: "Base", cardNumber: "4/102" });
    createCard({ game: "sports", name: "Mike Trout", setName: "Topps Update" });
    let progress = setProgress();
    expect(progress.map((p) => [p.setName, p.owned, p.total, p.supported])).toEqual([
      ["Base", 1, null, true],
      ["Topps Update", 1, null, false],
    ]);

    const rows = checklist.cards.map((c) => ({ name: c.name, number: c.number, set: { name: "Base" } }));
    await refreshChecklist(
      "pokemon",
      "Base",
      fakeFetch([
        ["v2/sets?q=", { data: [{ id: "base1", name: "Base" }] }],
        ["q=set.id:base1", { data: rows }],
      ]),
    );

    progress = setProgress();
    expect(progress[0]).toMatchObject({ setName: "Base", owned: 1, total: 3, missing: 2 });
    expect(getChecklist("pokemon", "base1")?.cards).toHaveLength(3);

    const detail = setDetail("pokemon", "Base");
    expect(detail.checklist?.setName).toBe("Base");
    expect([...detail.have]).toEqual(["4"]);
  });

  it("does nothing for a game with no checklist source", async () => {
    createCard({ game: "sports", name: "Mike Trout", setName: "Topps Update" });
    expect(await refreshChecklist("sports", "Topps Update", fakeFetch([]))).toBeNull();
  });
});
