/**
 * Network-facing checks with no dependencies: what may be a webhook, what is
 * a private address, whether a request came over TLS, and whether a proxy in
 * front of the app is trusted. Kept apart from the route helpers so that code
 * which must not pull the framework in can still use them.
 */

/** Whether a reverse proxy in front of the app is trusted to say who is asking and how. */
export function trustProxy(): boolean {
  return /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? "");
}

/**
 * Whether an address may be posted to as a webhook: an http(s) URL naming a
 * host that is not this machine or its network. The server makes the request
 * itself, so a URL pointing inward would let the settings page reach anything
 * the server can — a database admin panel, a cloud metadata service — with the
 * server's own standing. The literal forms are refused here; a name that
 * *resolves* inward is caught at delivery, by `assertPublicWebhook`.
 */
export function isWebhookUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return !isPrivateHost(u.hostname);
  } catch {
    return false;
  }
}

/** A hostname that names this machine or a private network, by its spelling alone. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "") return true;
  return isPrivateAddress(host);
}

/**
 * An IP address that is not on the public internet: loopback, link-local,
 * the private ranges, the unspecified and multicast blocks, and the IPv6
 * forms of the same, including IPv4 mapped into IPv6.
 */
export function isPrivateAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (!address.includes(":")) return false;
  const v6 = address.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  // IPv4 mapped or translated: ::ffff:10.0.0.1, ::ffff:a00:1, 64:ff9b::…
  const mapped = /^(?:::ffff:|::ffff:0:|64:ff9b::)(.+)$/.exec(v6);
  if (mapped) {
    const tail = mapped[1] ?? "";
    if (tail.includes(".")) return isPrivateAddress(tail);
    const [hi, lo] = tail.split(":");
    if (hi !== undefined && lo !== undefined) {
      const n = (parseInt(hi, 16) << 16) | parseInt(lo, 16);
      return isPrivateAddress(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`);
    }
    return true;
  }
  if (/^f[cd]/.test(v6)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(v6)) return true; // fe80::/10 link local
  if (/^ff/.test(v6)) return true; // multicast
  return false;
}

/**
 * Whether the request arrived over TLS: either directly, or through a proxy
 * this deployment trusts that says so. Decides whether a cookie may be marked
 * Secure — without which a session set behind a TLS-terminating proxy would
 * be sent over any plain-http path to the same host.
 */
export function isSecureRequest(request: Request): boolean {
  if (request.url.startsWith("https://")) return true;
  if (!trustProxy()) return false;
  const proto = request.headers.get("x-forwarded-proto");
  return (proto ? proto.split(",")[0] : null)?.trim().toLowerCase() === "https";
}

