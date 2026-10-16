/**
 * A fetch that answers from a table of URL fragments, so a provider can be
 * exercised without the network. Anything unlisted is a 404.
 */
export function fakeFetch(routes: Array<[string, unknown, number?]>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const hit = routes.find(([fragment]) => url.includes(fragment));
    if (!hit) return new Response("not found", { status: 404 });
    const [, body, status = 200] = hit;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}
