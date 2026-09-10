import { vi } from "vitest";

/** Build a fetch stub that answers by URL substring, in order of first match. */
export function fakeFetch(routes: Array<[string | RegExp, unknown, number?]>): typeof fetch {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const [match, body, status = 200] of routes) {
      const hit = typeof match === "string" ? url.includes(match) : match.test(url);
      if (hit) {
        return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("{}", { status: 404 });
  });
  return fn as unknown as typeof fetch;
}
