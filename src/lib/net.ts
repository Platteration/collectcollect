/**
 * Where the server is allowed to send a request that a stored setting points
 * at. The alert webhook is the only such setting: the owner types a URL and the
 * app POSTs to it from inside whatever network it is running in, which is a
 * request forwarder unless something says otherwise.
 *
 * The rule is the destination address, not the name: a public name that
 * resolves to 127.0.0.1 or 169.254.169.254 is the interesting case, and so is a
 * public URL that redirects to one (deliver() asks for the redirect rather than
 * following it).
 */

import { lookup } from "node:dns/promises";

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

/** Loopback, the private ranges, link-local (cloud metadata lives there), and everything above them. */
export function isPrivateAddress(address: string): boolean {
  const host = address.trim().toLowerCase().replace(/^\[|]$/g, "").split("%")[0];
  if (!host) return true;

  const v4 = parseIpv4(host);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // "this network"
    if (a === 10 || a === 127) return true; // private, loopback
    if (a === 169 && b === 254) return true; // link-local, including 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || b === 0)) return true; // private, IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    return a >= 224; // multicast, reserved, broadcast
  }

  if (!host.includes(":")) return false; // a name, not an address: the caller resolves it first

  // An IPv4 address written inside an IPv6 one (::ffff:127.0.0.1) is that address.
  const tail = host.slice(host.lastIndexOf(":") + 1);
  const mapped = parseIpv4(tail);
  if (mapped) return isPrivateAddress(tail);

  if (host === "::" || host === "::1") return true; // unspecified, loopback
  const first = Number.parseInt(host.replace(/^:+/, "").split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // unique local
  if ((first & 0xffc0) === 0xfe80) return true; // link local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * Why this URL must not be requested, or null when it may be. Resolution is
 * best effort: a name that answers differently a moment later would still be
 * reached, which is why the app only ever sends a fixed envelope here and never
 * reports the response back to a caller.
 */
export async function outboundRefusal(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "that is not a URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol} is not a URL this app will request`;

  const host = url.hostname.replace(/^\[|]$/g, "");
  if (!host) return "that URL has no host";
  if (isPrivateAddress(host)) return `${host} is on a private network`;
  if (/^localhost$|\.localhost$/.test(host)) return `${host} is this machine`;

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return `${host} could not be resolved`;
  }
  if (addresses.length === 0) return `${host} could not be resolved`;
  const blocked = addresses.find((a) => isPrivateAddress(a.address));
  return blocked ? `${host} resolves to ${blocked.address}, which is on a private network` : null;
}
