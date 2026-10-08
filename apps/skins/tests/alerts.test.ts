import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { WEBHOOK_TIMEOUT_MS, alertsForRefresh, createAlert, deliver } from "@/lib/alerts";
import type { PriceSummary } from "@/lib/types";
import { seedCase } from "./helpers";
import { DEFAULT_SETTINGS } from "@/lib/types";

function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`expected an element at ${i}`);
  return x;
}

const alert = () => createAlert({ kind: "price_move", itemId: null, title: "AK up 30%", body: "…" });
const settings = { ...DEFAULT_SETTINGS, alertWebhookUrl: "https://hooks.example/cc" };
/** The name resolves to somewhere on the public internet. */
const outward = async () => [{ address: "93.184.216.34" }];

describe("delivering an alert to a webhook", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));
  afterEach(() => vi.restoreAllMocks());

  it("posts the alert as JSON and says it landed", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    expect(await deliver(alert(), settings, fetchImpl, outward)).toBe(true);
    const [url, init] = at((fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls, 0);
    expect(url).toBe("https://hooks.example/cc");
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: "price_move", title: "AK up 30%" });
  });

  it("does nothing when there is no webhook", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await deliver(alert(), DEFAULT_SETTINGS, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a refusal and a failure rather than throwing, and says so in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await deliver(alert(), settings, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch, outward)).toBe(false);
    expect(await deliver(alert(), settings, (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch, outward)).toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]?.[0])).toContain("HTTP 500");
    expect(String(error.mock.calls[1]?.[1])).toContain("ECONNREFUSED");
  });

  it("does not follow a redirect, and refuses a name that resolves inward", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let init: RequestInit | undefined;
    const fetchImpl = (async (_url: string, i?: RequestInit) => {
      init = i;
      return new Response("ok");
    }) as unknown as typeof fetch;
    expect(await deliver(alert(), settings, fetchImpl, outward)).toBe(true);
    // An answer that bounced the request somewhere else would be a way to
    // point it inward after the address check; the request refuses to follow.
    expect(init?.redirect).toBe("error");

    // A public-looking name that resolves to this machine or its network.
    const inward = async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }];
    const posted = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    expect(await deliver(alert(), settings, posted, inward)).toBe(false);
    expect(posted).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[1])).toMatch(/resolves to 10\.0\.0\.5/);
    // And a name nothing can resolve is a failure, not a request.
    const unresolvable = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await deliver(alert(), settings, posted, unresolvable)).toBe(false);
    expect(posted).not.toHaveBeenCalled();
  });

  it("hands the webhook a deadline, and reports it running out", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // A fetch that never answers is cut off by the signal it is given; here
    // the cut-off is played back as the browser's TimeoutError.
    let signal: AbortSignal | undefined;
    const hanging = ((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    }) as unknown as typeof fetch;
    expect(await deliver(alert(), settings, hanging, outward)).toBe(false);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(WEBHOOK_TIMEOUT_MS).toBe(10_000);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[1])).toMatch(/timeout/i);
  });
});

describe("what a refresh is worth saying", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  const priced = (value: number): PriceSummary => ({
    currency: "USD",
    fetchedAt: "2026-06-01T00:00:00.000Z",
    market: value,
    marketSource: "Skinport",
    yourCopyValue: value,
    yourCopyBasis: "Skinport lowest ask",
    quotes: [],
    errors: [],
  });

  it("treats a threshold of zero as move alerts switched off", () => {
    const item = seedCase({ quantity: 1 });
    const moved = alertsForRefresh(item, priced(1), priced(1.5), { ...DEFAULT_SETTINGS, alertMovePercent: 10 });
    expect(moved.map((a) => a.kind)).toContain("price_move");
    // Zero used to fire on every refresh that changed a price by anything.
    const off = alertsForRefresh(item, priced(1), priced(1.5), { ...DEFAULT_SETTINGS, alertMovePercent: 0 });
    expect(off.map((a) => a.kind)).not.toContain("price_move");
  });
});
