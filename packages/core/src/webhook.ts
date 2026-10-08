import dns from "node:dns/promises";
import { isPrivateAddress, isWebhookUrl } from "./net";

export type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;

const systemLookup: Lookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

/**
 * Check a webhook address at the moment it is about to be used. The spelling
 * was checked when it was saved; this resolves the name and refuses one that
 * points at this machine or its network, which a public-looking name can do.
 * A record that changes between this check and the request is a narrower
 * hole than the one this closes, and the request that follows also refuses
 * to follow redirects, so an answer cannot bounce it inward either.
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
