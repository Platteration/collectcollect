// Loaded into both servers the suite starts (playwright.config.ts, NODE_OPTIONS
// --import), before Next: they can reach no host but their own. A saved card's
// first price refresh runs on the server, where no page.route can answer it, so
// without this a CI runner priced every card the suite adds against the real
// APIs, at whatever speed they answered that day, while a sandbox with no
// network failed the same lookups at once. Every lookup now fails at once, on
// every machine, with a message that says why.
const realFetch = globalThis.fetch;
const OWN_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

globalThis.fetch = function offlineFetch(input, init) {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let hostname;
  try {
    hostname = new URL(href).hostname;
  } catch {
    return realFetch(input, init); // not an absolute URL: fetch refuses it itself
  }
  if (OWN_HOSTS.has(hostname)) return realFetch(input, init);
  return Promise.reject(new TypeError(`fetch failed: the e2e servers have no network (${hostname})`));
};
