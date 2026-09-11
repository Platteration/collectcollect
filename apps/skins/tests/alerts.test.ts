import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { WEBHOOK_TIMEOUT_MS, createAlert, deliver } from "@/lib/alerts";
import { DEFAULT_SETTINGS } from "@/lib/types";

function at<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`expected an element at ${i}`);
  return x;
}

const alert = () => createAlert({ kind: "price_move", itemId: null, title: "AK up 30%", body: "…" });
const settings = { ...DEFAULT_SETTINGS, alertWebhookUrl: "https://hooks.example/cc" };

describe("delivering an alert to a webhook", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));
  afterEach(() => vi.restoreAllMocks());

  it("posts the alert as JSON and says it landed", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    expect(await deliver(alert(), settings, fetchImpl)).toBe(true);
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
    expect(await deliver(alert(), settings, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch)).toBe(false);
    expect(await deliver(alert(), settings, (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch)).toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]?.[0])).toContain("HTTP 500");
    expect(String(error.mock.calls[1]?.[1])).toContain("ECONNREFUSED");
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
    expect(await deliver(alert(), settings, hanging)).toBe(false);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(WEBHOOK_TIMEOUT_MS).toBe(10_000);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[1])).toMatch(/timeout/i);
  });
});
