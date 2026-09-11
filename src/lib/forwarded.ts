/**
 * What an `X-Forwarded-*` header may be believed to say.
 *
 * Nothing in the App Router exposes the socket address, so anything this app
 * knows about the caller comes from a header — and a header is whatever the
 * client says unless a proxy is known to have written it. One module answers
 * that question so the rate limiter and the session cookie cannot answer it
 * differently, which is exactly what happened when only one of them was taught
 * about TRUSTED_PROXY_HOPS.
 *
 * Kept free of any other import: the proxy bundle and the route handlers both
 * reach it.
 */

import net from "node:net";

/**
 * How many reverse proxies in front of this app write `X-Forwarded-For`.
 *
 * Zero means no proxy is trusted, which is the default; TRUST_PROXY means one,
 * the shape of every deployment the README describes; TRUSTED_PROXY_HOPS names
 * a number for anything longer.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.TRUSTED_PROXY_HOPS);
  if (Number.isInteger(configured) && configured > 0) return configured;
  return env.TRUST_PROXY ? 1 : 0;
}

/**
 * The entry a trusted proxy wrote, counted from the right.
 *
 * Every mainstream proxy *appends* to these headers rather than rewriting them
 * — nginx's `$proxy_add_x_forwarded_for`, Caddy's reverse_proxy default — so
 * the leftmost entry is whatever the client typed and the rightmost is what the
 * nearest proxy saw. Reading from the left believes the client. A chain shorter
 * than the configured hop count was not written by the proxies the operator
 * says are there, so it is not believed either.
 */
export function forwardedEntry(header: string | null | undefined, hops: number): string | null {
  if (hops <= 0) return null;
  const chain = (header ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return chain.length >= hops ? chain[chain.length - hops] : null;
}

/** An `X-Forwarded-For` entry that really is an address, with any port removed. */
export function asAddress(entry: string): string | null {
  if (net.isIP(entry)) return entry;
  // `[::1]:8080` and `198.51.100.9:8080` are both legal in a forwarded chain.
  const bare = entry.startsWith("[") ? entry.slice(1).split("]")[0] : entry.split(":").length === 2 ? entry.split(":")[0] : entry;
  return net.isIP(bare) ? bare : null;
}
