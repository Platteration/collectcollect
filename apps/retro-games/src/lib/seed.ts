import type { SeedItem } from "@collectcollect/core/domain/spec";
import type { Game } from "./types";

/** An ISO date this many months ago, so the sample history always ends today. */
function ago(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** A run of values that ends at `now`, spread over the last year and a half. */
function history(then: number, now: number, ...between: number[]): Array<{ value: number; at: string; note?: string }> {
  const values = [then, ...between, now];
  const months = [18, 12, 9, 6, 3, 1, 0].slice(-values.length);
  return values.map((value, i) => ({ value, at: ago(months[i]), note: i === values.length - 1 ? "PriceCharting (sample)" : "Sample value" }));
}

/**
 * A believable shelf, so the dashboard has something to show on first run:
 * common carts in a stack, a sealed Game Boy classic, two slabs, a Saturn RPG
 * that appreciated and a PAL Mega Drive game that did not. Prices are
 * plausible for the dates, not quotes.
 */
export const SEED: SeedItem<Game>[] = [
  {
    input: { title: "Super Mario 64", platform: "n64", region: "ntsc_u", releaseYear: 1996, publisher: "Nintendo", completeness: "cib", boxCondition: "very_good", manualCondition: "near_mint", mediaCondition: "near_mint", location: "Shelf A", purchasePrice: 45 },
    lot: { acquiredAt: `${new Date().getFullYear() - 5}-06-14`, source: "Local game shop" },
    history: history(95, 180, 120, 140, 165, 170),
  },
  {
    input: { title: "Chrono Trigger", platform: "snes", region: "ntsc_u", releaseYear: 1995, publisher: "Square", completeness: "loose", mediaCondition: "very_good", quantity: 2, purchasePrice: 120, location: "Shelf A" },
    lot: { quantity: 2, acquiredAt: `${new Date().getFullYear() - 3}-03-02`, source: "eBay" },
    history: history(150, 215, 170, 190, 205, 210),
  },
  {
    input: { title: "EarthBound", platform: "snes", region: "ntsc_u", releaseYear: 1995, publisher: "Nintendo", completeness: "cib", boxCondition: "good", manualCondition: "good", mediaCondition: "very_good", variant: "Big box with player's guide", location: "Safe", purchasePrice: 600, notes: "Guide has a creased cover; scratch-and-sniff cards intact." },
    lot: { acquiredAt: `${new Date().getFullYear() - 6}-11-20`, source: "Convention" },
    history: history(900, 1350, 1000, 1150, 1280, 1320),
  },
  {
    input: { title: "Pokémon Red Version", platform: "game_boy", region: "ntsc_u", releaseYear: 1998, publisher: "Nintendo", completeness: "sealed", boxCondition: "near_mint", location: "Safe", purchasePrice: 2400, notes: "H-seam seal, one small tear in the wrap on the back." },
    lot: { acquiredAt: `${new Date().getFullYear() - 4}-02-01`, source: "Heritage Auctions" },
    history: history(3200, 3600, 2900, 3100, 3450, 3550),
  },
  {
    input: { title: "The Legend of Zelda: Ocarina of Time", platform: "n64", region: "ntsc_u", releaseYear: 1998, publisher: "Nintendo", completeness: "graded", gradingCompany: "wata", grade: "9.4 A+", certNumber: "0921347001", boxCondition: "near_mint", location: "Safe", purchasePrice: 800, manualValue: 950 },
    lot: { acquiredAt: `${new Date().getFullYear() - 2}-08-15`, source: "Goldin" },
    history: history(1100, 950, 1000, 980, 940, 960),
  },
  {
    input: { title: "Sonic the Hedgehog 2", platform: "genesis", region: "pal", releaseYear: 1992, publisher: "Sega", completeness: "cib", boxCondition: "good", manualCondition: "good", mediaCondition: "good", quantity: 3, purchasePrice: 12, location: "Box 3" },
    lot: { quantity: 3, acquiredAt: `${new Date().getFullYear() - 1}-05-09`, source: "Car boot sale" },
    history: history(14, 15, 15, 14, 16, 15),
  },
  {
    input: { title: "Final Fantasy VII", platform: "ps1", region: "ntsc_u", releaseYear: 1997, publisher: "Sony", completeness: "cib", boxCondition: "very_good", manualCondition: "very_good", mediaCondition: "very_good", variant: "Black label", location: "Shelf B", purchasePrice: 60 },
    lot: { acquiredAt: `${new Date().getFullYear() - 4}-09-30`, source: "Facebook Marketplace" },
    history: history(70, 115, 80, 95, 105, 110),
  },
  {
    input: { title: "Panzer Dragoon Saga", platform: "saturn", region: "ntsc_u", releaseYear: 1998, publisher: "Sega", completeness: "cib", boxCondition: "very_good", manualCondition: "near_mint", mediaCondition: "very_good", location: "Shelf B", purchasePrice: 450, notes: "All four discs, no cracked hinges." },
    lot: { acquiredAt: `${new Date().getFullYear() - 7}-01-12`, source: "eBay" },
    history: history(650, 1050, 800, 900, 980, 1020),
  },
  {
    input: { title: "Super Metroid", platform: "snes", region: "ntsc_j", releaseYear: 1994, publisher: "Nintendo", completeness: "loose", mediaCondition: "mint", location: "Shelf A", purchasePrice: 25 },
    lot: { acquiredAt: `${new Date().getFullYear() - 2}-04-22`, source: "Super Potato, Akihabara" },
    history: history(28, 35, 30, 32, 34, 34),
  },
  {
    input: { title: "Metroid Prime", platform: "gamecube", region: "ntsc_u", releaseYear: 2002, publisher: "Nintendo", completeness: "graded", gradingCompany: "vga", grade: "85", certNumber: "VGA-0448812", boxCondition: "near_mint", location: "Safe", purchasePrice: 400 },
    lot: { acquiredAt: `${new Date().getFullYear() - 3}-12-03`, source: "eBay" },
    history: history(420, 520, 450, 480, 500, 515),
  },
];
