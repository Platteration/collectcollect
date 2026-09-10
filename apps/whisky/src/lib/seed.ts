import type { SeedItem } from "@collectcollect/core/domain/spec";
import type { Bottle } from "./types";

function ago(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** A run of values ending at `now`, spread over the last year and a half. */
function history(then: number, now: number, ...between: number[]): Array<{ value: number; at: string; note?: string }> {
  const values = [then, ...between, now];
  const months = [18, 12, 9, 6, 3, 1, 0].slice(-values.length);
  return values.map((value, i) => ({ value, at: ago(months[i]), note: i === values.length - 1 ? "Whisky Auctioneer hammer (sample)" : "Sample value" }));
}

const year = new Date().getFullYear();

/**
 * A believable shelf: a stack of three Springbanks, two Uigeadails in
 * tubes, a couple of boxed sherried malts, a numbered Port Ellen, a
 * Japanese bottle that ran away, and two open bottles for drinking that
 * keep the value they had the day they were opened. Values are plausible
 * for the dates, not quotes.
 */
export const SEED: SeedItem<Bottle>[] = [
  {
    input: { distillery: "Springbank", expression: "10 Year Old", ageStatement: 10, bottlingYear: year - 2, caskType: "bourbon and sherry casks", abv: 46, bottleSize: 700, region: "campbeltown", packaging: "box", sealed: true, quantity: 3, purchasePrice: 75, location: "Cabinet" },
    lot: { quantity: 3, acquiredAt: `${year - 2}-03-14`, source: "Local shop, one per customer" },
    history: history(90, 145, 110, 120, 135, 140),
  },
  {
    input: { distillery: "Ardbeg", expression: "Uigeadail", ageStatement: null, bottlingYear: year - 1, caskType: "bourbon and sherry casks", abv: 54.2, bottleSize: 700, bottleNumber: "L2311", region: "islay", packaging: "tube", sealed: true, quantity: 2, purchasePrice: 82, location: "Cabinet" },
    lot: { quantity: 2, acquiredAt: `${year - 1}-11-20`, source: "Master of Malt" },
    history: history(85, 92, 88, 90, 90, 92),
  },
  {
    input: { distillery: "Lagavulin", expression: "16 Year Old", ageStatement: 16, abv: 43, bottleSize: 700, region: "islay", packaging: "box", sealed: false, openedAt: `${year - 1}-12-25`, fillLevel: 60, frozenValue: 78, quantity: 1, purchasePrice: 70, location: "Drinks trolley", notes: "Opened at Christmas." },
    lot: { acquiredAt: `${year - 2}-12-20`, source: "Supermarket" },
    history: history(70, 78, 72, 74, 76, 78),
  },
  {
    input: { distillery: "The Macallan", expression: "18 Year Old Sherry Oak", ageStatement: 18, bottlingYear: 2019, caskType: "oloroso sherry seasoned oak", abv: 43, bottleSize: 700, region: "speyside", packaging: "box", sealed: true, purchasePrice: 280, location: "Safe" },
    lot: { acquiredAt: `${year - 5}-06-01`, source: "The Whisky Exchange" },
    history: history(380, 460, 400, 420, 445, 455),
  },
  {
    input: { distillery: "Yamazaki", expression: "12 Year Old", ageStatement: 12, abv: 43, bottleSize: 700, region: "japan", packaging: "box", sealed: true, purchasePrice: 95, location: "Safe" },
    lot: { acquiredAt: "2016-04-03", source: "Duty free, Narita" },
    history: history(260, 300, 280, 285, 295, 300),
  },
  {
    input: { distillery: "Buffalo Trace", expression: "Kentucky Straight Bourbon", ageStatement: null, abv: 45, bottleSize: 750, region: "usa", packaging: "none", sealed: false, openedAt: `${year}-01-10`, fillLevel: 40, frozenValue: 32, purchasePrice: 30, location: "Drinks trolley" },
    lot: { acquiredAt: `${year - 1}-10-05`, source: "Supermarket" },
    history: history(30, 32, 31, 32, 32, 32),
  },
  {
    input: { distillery: "Glenfarclas", expression: "105 Cask Strength", ageStatement: null, abv: 60, bottleSize: 1000, region: "speyside", packaging: "tube", sealed: true, purchasePrice: 58, location: "Cabinet" },
    lot: { acquiredAt: `${year - 3}-08-12`, source: "Local shop" },
    history: history(60, 68, 62, 64, 66, 68),
  },
  {
    input: { distillery: "Port Ellen", expression: "1979 Annual Release, 6th", ageStatement: 27, vintage: 1979, bottlingYear: 2006, caskType: "refill American oak and sherry", abv: 54.2, bottleSize: 700, bottleNumber: "Bottle 2417 of 5400", region: "islay", packaging: "box", sealed: true, purchasePrice: 900, location: "Safe", notes: "Closed distillery. Capsule perfect, label clean." },
    lot: { acquiredAt: `${year - 8}-02-28`, source: "Scotch Whisky Auctions" },
    history: history(2200, 2900, 2500, 2650, 2800, 2850),
  },
];
