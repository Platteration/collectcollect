import type { SeedItem } from "@collectcollect/core/domain/spec";
import type { Comic } from "./types";

function ago(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** A run of values ending at `now`, spread over the last year and a half. */
function history(then: number, now: number, ...between: number[]): Array<{ value: number; at: string; note?: string }> {
  const values = [then, ...between, now];
  const months = [18, 12, 9, 6, 3, 1, 0].slice(-values.length);
  return values.map((value, i) => ({ value, at: ago(months[i]), note: i === values.length - 1 ? "PriceCharting (sample)" : "Sample value" }));
}

const year = new Date().getFullYear();

/**
 * A believable long box, so the dashboard has something to show on first
 * run: two slabs, a signature series, a raw key that wants grading, a stack
 * of a modern key, and a couple of cheap fillers. Prices are plausible for
 * the dates, not quotes.
 */
export const SEED: SeedItem<Comic>[] = [
  {
    input: { title: "The Amazing Spider-Man", publisher: "Marvel", issueNumber: "300", volume: 1, coverDate: "1988-05", keyFlags: ["first_appearance"], keyOf: "Venom (Eddie Brock)", slabbed: true, gradingCompany: "cgc", grade: "9.4", certNumber: "2036123-004", pageQuality: "white", location: "Safe", purchasePrice: 900, notes: "Todd McFarlane cover; 25th anniversary issue." },
    lot: { acquiredAt: `${year - 3}-04-18`, source: "Heritage Auctions" },
    history: history(1150, 1400, 1250, 1300, 1380, 1390),
  },
  {
    input: { title: "The Incredible Hulk", publisher: "Marvel", issueNumber: "181", volume: 1, coverDate: "1974-11", keyFlags: ["first_appearance"], keyOf: "Wolverine", slabbed: false, grade: "4.0", pageQuality: "off_white", location: "Safe", purchasePrice: 1800, notes: "Marvel Value Stamp intact. Subscription crease, small chip at the spine." },
    lot: { acquiredAt: `${year - 6}-09-02`, source: "Convention" },
    history: history(2600, 3400, 2900, 3100, 3300, 3350),
  },
  {
    input: { title: "X-Men", publisher: "Marvel", issueNumber: "1", volume: 2, coverDate: "1991-10", variant: "Cover E (gatefold)", keyFlags: ["first_issue"], keyOf: null, slabbed: false, grade: "9.4", quantity: 3, purchasePrice: 8, location: "Long box 2", notes: "Jim Lee gatefold; the best-selling comic ever printed." },
    lot: { quantity: 3, acquiredAt: `${year - 2}-01-15`, source: "Dollar bin" },
    history: history(12, 18, 14, 15, 17, 18),
  },
  {
    input: { title: "Saga", publisher: "Image", issueNumber: "1", volume: 1, coverDate: "2012-03", keyFlags: ["first_issue", "first_appearance"], keyOf: "Hazel, Alana and Marko", slabbed: true, gradingCompany: "cbcs", grade: "9.8", certNumber: "19-2C4E7A1B-001", pageQuality: "white", location: "Safe", purchasePrice: 240 },
    lot: { acquiredAt: `${year - 2}-06-30`, source: "eBay" },
    history: history(300, 260, 280, 270, 255, 260),
  },
  {
    input: { title: "Batman", publisher: "DC", issueNumber: "423", volume: 1, coverDate: "1988-09", keyFlags: ["classic_cover"], keyOf: "Todd McFarlane cover", slabbed: false, grade: "8.5", location: "Long box 1", purchasePrice: 60 },
    lot: { acquiredAt: `${year - 4}-11-11`, source: "Local comic shop" },
    history: history(85, 120, 95, 100, 110, 118),
  },
  {
    input: { title: "Ultimate Fallout", publisher: "Marvel", issueNumber: "4", volume: 1, coverDate: "2011-10", keyFlags: ["first_appearance"], keyOf: "Miles Morales", slabbed: true, gradingCompany: "cgc", grade: "9.8", certNumber: "3742009-012", pageQuality: "white", signatureSeries: true, location: "Safe", purchasePrice: 700, notes: "Signed by Brian Michael Bendis, Signature Series." },
    lot: { acquiredAt: `${year - 1}-03-08`, source: "ComicLink" },
    history: history(900, 1000, 950, 940, 980, 990),
  },
  {
    input: { title: "The Walking Dead", publisher: "Image", issueNumber: "1", volume: 1, coverDate: "2003-10", keyFlags: ["first_issue", "first_appearance"], keyOf: "Rick Grimes", slabbed: false, grade: "9.2", location: "Safe", purchasePrice: 1500, notes: "First printing; black and white interior, no overspray on the cover." },
    lot: { acquiredAt: `${year - 5}-05-05`, source: "eBay" },
    history: history(2200, 2500, 2300, 2350, 2450, 2480),
  },
  {
    input: { title: "The New Mutants", publisher: "Marvel", issueNumber: "98", volume: 1, coverDate: "1991-02", keyFlags: ["first_appearance"], keyOf: "Deadpool", slabbed: false, grade: "9.0", variant: "Newsstand", location: "Long box 1", purchasePrice: 250 },
    lot: { acquiredAt: `${year - 3}-08-20`, source: "Facebook Marketplace" },
    history: history(320, 400, 350, 360, 380, 395),
  },
  {
    input: { title: "Action Comics", publisher: "DC", issueNumber: "1000", volume: 1, coverDate: "2018-06", variant: "Jim Lee cover", keyFlags: ["adaptation"], keyOf: "80th anniversary", slabbed: false, grade: "9.6", quantity: 2, purchasePrice: 8, location: "Long box 2" },
    lot: { quantity: 2, acquiredAt: `${year - 1}-10-01`, source: "Local comic shop" },
    history: history(10, 12, 11, 11, 12, 12),
  },
];
