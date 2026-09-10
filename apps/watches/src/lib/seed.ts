import type { SeedItem } from "@collectcollect/core/domain/spec";
import type { Watch } from "./types";

function ago(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** A run of values ending at `now`, spread over the last year and a half. */
function history(then: number, now: number, ...between: number[]): Array<{ value: number; at: string; note?: string }> {
  const values = [then, ...between, now];
  const months = [18, 12, 9, 6, 3, 1, 0].slice(-values.length);
  return values.map((value, i) => ({ value, at: ago(months[i]), note: i === values.length - 1 ? "Chrono24 median listing (sample)" : "Sample value" }));
}

const year = new Date().getFullYear();

/**
 * A believable watch box: a couple of steel sports watches that appreciated,
 * a vintage Datejust, a dress quartz, an everyday Seiko and a G-Shock, with
 * service histories where a watch of that age would have one. Serial numbers
 * are made up and shaped like the real thing. Values are plausible for the
 * dates, not quotes.
 */
export const SEED: SeedItem<Watch>[] = [
  {
    input: { brand: "Rolex", model: "Submariner", referenceNumber: "124060", serialNumber: "7K2R4X81", movement: "automatic", caliber: "3230", caseSize: 41, caseMaterial: "steel", dial: "black, maxi dial, no date", braceletStrap: "Oyster bracelet, Glidelock clasp", year: year - 4, boxPapers: "both", condition: "excellent", location: "Safe", purchasePrice: 9100, notes: "Bought from an AD; card dated and stamped." },
    lot: { acquiredAt: `${year - 4}-05-12`, source: "Authorised dealer" },
    history: history(11800, 12400, 12800, 12100, 12000, 12300),
  },
  {
    input: { brand: "Omega", model: "Speedmaster Professional Moonwatch", referenceNumber: "310.30.42.50.01.001", serialNumber: "88 412 553", movement: "manual", caliber: "3861", caseSize: 42, caseMaterial: "steel", dial: "black, step dial, Hesalite crystal", braceletStrap: "steel bracelet", year: year - 3, boxPapers: "both", condition: "excellent", location: "Safe", purchasePrice: 6400 },
    lot: { acquiredAt: `${year - 3}-11-02`, source: "Omega boutique" },
    history: history(6200, 6600, 6300, 6400, 6500, 6550),
  },
  {
    input: { brand: "Tudor", model: "Black Bay 58", referenceNumber: "79030N", serialNumber: "J9F4K221", movement: "automatic", caliber: "MT5402", caseSize: 39, caseMaterial: "steel", dial: "black, gilt", braceletStrap: "rivet-style steel bracelet", year: year - 5, boxPapers: "both", condition: "good", location: "Watch box", purchasePrice: 3200, notes: "Light desk-diving marks on the clasp." },
    lot: { acquiredAt: `${year - 5}-08-19`, source: "Authorised dealer" },
    history: history(3400, 3300, 3450, 3350, 3300, 3300),
  },
  {
    input: { brand: "Rolex", model: "Datejust 36", referenceNumber: "16234", serialNumber: "W447128", movement: "automatic", caliber: "3135", caseSize: 36, caseMaterial: "steel", dial: "silver, stick indices", braceletStrap: "Jubilee bracelet, white-gold fluted bezel", year: 1995, boxPapers: "neither", condition: "good", location: "Safe", purchasePrice: 3800, serviceHistory: [{ date: `${year - 6}-02-14`, notes: "Full service, independent watchmaker; mainspring and gaskets replaced." }, { date: `${year - 1}-09-30`, notes: "Crystal replaced (sapphire), bracelet tightened." }] },
    lot: { acquiredAt: `${year - 7}-03-21`, source: "Estate sale" },
    history: history(4900, 5600, 5100, 5300, 5450, 5500),
  },
  {
    input: { brand: "Grand Seiko", model: "Snowflake", referenceNumber: "SBGA211", serialNumber: "6D0412", movement: "automatic", caliber: "9R65 Spring Drive", caseSize: 41, caseMaterial: "titanium", dial: "white, snowflake texture, blued seconds hand", braceletStrap: "titanium bracelet", year: year - 2, boxPapers: "both", condition: "excellent", location: "Watch box", purchasePrice: 5200 },
    lot: { acquiredAt: `${year - 2}-06-05`, source: "Grand Seiko boutique" },
    history: history(4600, 4900, 4700, 4750, 4800, 4850),
  },
  {
    input: { brand: "Cartier", model: "Tank Must", referenceNumber: "WSTA0041", serialNumber: "AB4H7Q2L", movement: "quartz", caliber: "1847 MC quartz", caseSize: 33.7, caseMaterial: "steel", dial: "silvered, Roman numerals", braceletStrap: "black leather strap", year: year - 1, boxPapers: "both", condition: "new", location: "Watch box", purchasePrice: 3050 },
    lot: { acquiredAt: `${year - 1}-12-20`, source: "Cartier boutique" },
    history: history(2900, 3000, 2950, 2950, 3000, 3000),
  },
  {
    input: { brand: "Seiko", model: "SKX007", referenceNumber: "SKX007K2", serialNumber: "9N2287", movement: "automatic", caliber: "7S26", caseSize: 42.5, caseMaterial: "steel", dial: "black", braceletStrap: "rubber strap", year: 2015, boxPapers: "box", condition: "good", location: "Desk drawer", purchasePrice: 180, serviceHistory: [{ date: `${year - 2}-04-11`, notes: "Regulated and pressure tested at a local watchmaker." }] },
    lot: { acquiredAt: "2016-01-09", source: "eBay" },
    history: history(280, 380, 300, 330, 360, 375),
  },
  {
    input: { brand: "Casio", model: "G-Shock DW-5600E", referenceNumber: "DW-5600E-1V", serialNumber: null, movement: "quartz", caliber: "3229", caseSize: 42.8, caseMaterial: "resin", dial: "digital, negative display off", braceletStrap: "resin strap", year: year - 3, boxPapers: "neither", condition: "fair", location: "Desk drawer", purchasePrice: 45, notes: "Beater; strap replaced once." },
    lot: { acquiredAt: `${year - 3}-07-07`, source: "Amazon" },
    history: history(45, 45, 45, 45, 45, 45),
  },
];
