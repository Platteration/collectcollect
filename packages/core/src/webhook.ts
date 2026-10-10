import dns from "node:dns/promises";
import net, { type LookupFunction } from "node:net";
import { isPrivateAddress, isWebhookUrl } from "./net";
import { publicRequest } from "./public-request";

export type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;

const systemLookup: Lookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

/**
 * Check a webhook address at the moment it is about to be used. The spelling
 * was checked when it was saved; this resolves the name and refuses one that
 * points at this machine or its network, which a public-looking name can do.
 * Delivery also uses publicWebhookLookup inside the actual socket, so a
 * changing DNS answer cannot point the connection inward after this check.
 */
export async function assertPublicWebhook(url: string, lookup: Lookup = systemLookup): Promise<void> {
  if (!isWebhookUrl(url)) throw new Error("The webhook address is not an http(s) address on the public internet");
  const { hostname } = new URL(url);
  const bare = hostname.replace(/^\[|\]$/g, "");
  // A literal address was already judged by its spelling.
  if (/^[\d.]+$/.test(bare) || bare.includes(":")) return;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(bare);
  } catch (e) {
    throw new Error(`The webhook host could not be resolved: ${e instanceof Error ? e.message : e}`);
  }
  if (addresses.length === 0) throw new Error("The webhook host resolves to nothing");
  const inward = addresses.find((a) => isPrivateAddress(a.address));
  if (inward) throw new Error(`The webhook host resolves to ${inward.address}, which is not on the public internet`);
}

/** DNS answers are validated inside the socket lookup and never resolved a second time. */
export function publicWebhookLookup(lookup: Lookup = systemLookup): LookupFunction {
  return (host, options, callback) => {
    lookup(host).then((addresses) => {
      if (!addresses.length) throw new Error("The webhook host resolves to nothing");
      const resolved = addresses.map(({ address }) => ({ address, family: net.isIP(address) }));
      for (const { address, family } of resolved) {
        // Canonicalize IPv6, including fully expanded loopback and mapped spellings from DNS.
        const canonical = family === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
        if (!family || isPrivateAddress(canonical)) throw new Error(`The webhook host resolves to ${address}, which is not on the public internet`);
      }
      const chosen = options.family ? resolved.filter((a) => a.family === Number(options.family)) : resolved;
      if (!chosen.length) throw new Error("The webhook host has no address for the requested family");
      if (options.all) callback(null, chosen);
      else callback(null, chosen[0]!.address, chosen[0]!.family);
    }).catch((err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), "", 0));
  };
}

/** Validate literal hosts and make a redirect-free exchange with guarded socket DNS. */
export async function requestPublicWebhook(url: string, init: RequestInit, lookup?: Lookup): Promise<Response> {
  if (!isWebhookUrl(url)) throw new Error("The webhook address is not an http(s) address on the public internet");
  return publicRequest(url, { ...init, redirect: "error" }, publicWebhookLookup(lookup));
}
