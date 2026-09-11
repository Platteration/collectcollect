import type { AppliedSticker, Category, Exterior, ItemInput, Rarity } from "../types";
import { EXTERIOR_IDS, isStackable } from "../types";
import { lookup } from "@collectcollect/core/lookup";

/**
 * Reading a CS2 inventory out of Steam's public endpoint.
 *
 * `steamcommunity.com/inventory/<steamid64>/730/2` answers for any inventory
 * set to public. It returns two lists — `assets`, one entry per object held,
 * and `descriptions`, one entry per *kind* of object — joined on classid and
 * instanceid. Everything interesting is on the description; the asset carries
 * the identity and, for stackables, how many.
 *
 * What it does not carry is the float or the pattern seed. Those live in the
 * game and are only reachable by resolving an item's inspect link through a
 * float service, so this leaves both null and the app says the column is not
 * filled in rather than showing a blank that looks like a reading.
 *
 * The parser is separate from the fetch so it can be held to recorded
 * responses, which is the only way to test it here: this sandbox's egress proxy
 * refuses steamcommunity.com outright.
 */

export interface SteamTag {
  category?: string;
  internal_name?: string;
  localized_tag_name?: string;
}

export interface SteamDescription {
  classid?: string;
  instanceid?: string;
  market_hash_name?: string;
  name?: string;
  type?: string;
  icon_url?: string;
  tradable?: number;
  marketable?: number;
  market_tradable_restriction?: number;
  tags?: SteamTag[];
  descriptions?: Array<{ name?: string; value?: string }>;
  owner_descriptions?: Array<{ name?: string; value?: string }>;
  actions?: Array<{ link?: string; name?: string }>;
  fraudwarnings?: string[];
}

export interface SteamAsset {
  assetid?: string;
  classid?: string;
  instanceid?: string;
  amount?: string;
}

export interface SteamInventory {
  success?: number;
  error?: string;
  assets?: SteamAsset[];
  descriptions?: SteamDescription[];
  total_inventory_count?: number;
}

/** Steam's own item-type tag, mapped onto what this app calls things. */
const TYPE_TO_CATEGORY: Record<string, Category> = {
  csgo_type_pistol: "weapon",
  csgo_type_rifle: "weapon",
  csgo_type_smg: "weapon",
  csgo_type_shotgun: "weapon",
  csgo_type_sniperrifle: "weapon",
  csgo_type_machinegun: "weapon",
  csgo_type_knife: "knife",
  type_hands: "glove",
  csgo_type_weaponcase: "case",
  csgo_tool_sticker: "sticker",
  csgo_tool_patch: "patch",
  csgo_tool_keychain: "charm",
  csgo_type_spray: "graffiti",
  csgo_type_musickit: "music_kit",
  csgo_type_collectible: "pin",
  csgo_type_ticket: "pass",
  csgo_tool_weaponcase_keytag: "key",
  csgo_tool_key: "key",
  type_customplayer: "agent",
};

/**
 * Steam's rarity tags. Weapons and everything else use different names for the
 * same colours, so both families land on one ladder.
 */
const RARITY_TAGS: Record<string, Rarity> = {
  rarity_common_weapon: "consumer",
  rarity_uncommon_weapon: "industrial",
  rarity_rare_weapon: "mil_spec",
  rarity_mythical_weapon: "restricted",
  rarity_legendary_weapon: "classified",
  rarity_ancient_weapon: "covert",
  rarity_common: "consumer",
  rarity_uncommon: "industrial",
  rarity_rare: "mil_spec",
  rarity_mythical: "restricted",
  rarity_legendary: "classified",
  rarity_ancient: "covert",
  rarity_contraband: "contraband",
};

const WEAR_TAGS: Record<string, Exterior> = {
  wearcategory0: "factory_new",
  wearcategory1: "minimal_wear",
  wearcategory2: "field_tested",
  wearcategory3: "well_worn",
  wearcategory4: "battle_scarred",
};

function tag(description: SteamDescription, category: string): SteamTag | undefined {
  return description.tags?.find((t) => (t.category ?? "").toLowerCase() === category.toLowerCase());
}

function lower(value: string | undefined): string {
  return (value ?? "").toLowerCase();
}

/** Steam serves every icon from its own CDN, at whatever size the path asks for. */
export function imageUrlFor(iconUrl: string | undefined): string | null {
  if (!iconUrl) return null;
  return `https://community.cloudflare.steamstatic.com/economy/image/${iconUrl}/360fx360f`;
}

function categoryFor(description: SteamDescription): Category {
  const internal = lower(tag(description, "Type")?.internal_name);
  const known = lookup(TYPE_TO_CATEGORY, internal);
  if (known) return known;
  // A knife with no usable Type tag still announces itself: every one of them
  // is named with a star.
  if ((description.market_hash_name ?? "").startsWith("★")) {
    return lower(tag(description, "Type")?.localized_tag_name).includes("glove") ? "glove" : "knife";
  }
  const type = lower(description.type);
  if (type.includes("container") || type.includes("case")) return "case";
  if (type.includes("capsule")) return "capsule";
  if (type.includes("sticker")) return "sticker";
  if (type.includes("graffiti")) return "graffiti";
  if (type.includes("agent")) return "agent";
  return "other";
}

function rarityFor(description: SteamDescription, category: Category): Rarity | null {
  // Knives and gloves are gold in the game whatever their weapon-rarity tag
  // says, and calling one Covert would file it with the red rifles.
  if (category === "knife" || category === "glove") return "extraordinary";
  const internal = lower(tag(description, "Rarity")?.internal_name);
  return lookup(RARITY_TAGS, internal) ?? null;
}

function exteriorFor(description: SteamDescription): Exterior | null {
  const internal = lower(tag(description, "Exterior")?.internal_name);
  const tagged = lookup(WEAR_TAGS, internal);
  if (tagged) return tagged;
  // Fall back to the tier printed in the name, which is where it comes from.
  const name = description.market_hash_name ?? "";
  const match = /\(([^)]+)\)\s*$/.exec(name);
  if (!match) return null;
  const printed = (match[1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return EXTERIOR_IDS.find((id) => id.replace(/_/g, "") === printed) ?? null;
}

/** "AK-47 | Redline (Field-Tested)" split into the gun and the finish. */
function weaponAndFinish(marketHashName: string): { weapon: string | null; finish: string | null } {
  const withoutWear = marketHashName.replace(/\s*\([^)]*\)\s*$/, "");
  const bar = withoutWear.indexOf("|");
  if (bar === -1) return { weapon: null, finish: null };
  const weapon = withoutWear
    .slice(0, bar)
    .replace(/^★\s*/, "")
    .replace(/^StatTrak™\s*/, "")
    .replace(/^Souvenir\s*/, "")
    .trim();
  return { weapon: weapon || null, finish: withoutWear.slice(bar + 1).trim() || null };
}

/**
 * The stickers applied to a weapon.
 *
 * Steam puts them in an HTML blob rather than in structured data, so this reads
 * the names out of it. Their wear is not in the blob at all — only an inspect
 * of the item itself has that — so each comes back unscratched-unknown rather
 * than as zero, which would claim they were pristine.
 */
export function stickersFrom(description: SteamDescription): AppliedSticker[] {
  const blob = description.descriptions?.find((d) => lower(d.name) === "sticker_info")?.value;
  if (!blob) return [];
  const label = /Sticker:\s*([^<]+)/.exec(blob.replace(/<br\s*\/?>/gi, " "));
  if (!label) return [];
  return (label[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, slot) => ({ slot, name, marketHashName: `Sticker | ${name}`, wear: null }));
}

/** `Name Tag: ''old faithful''` is how a custom name arrives. */
export function nameTagFrom(description: SteamDescription): string | null {
  for (const warning of description.fraudwarnings ?? []) {
    const match = /Name Tag:\s*''(.*)''\s*$/.exec(warning);
    if (match) return (match[1] ?? "").trim() || null;
  }
  return null;
}

/**
 * When a trade lock lifts.
 *
 * Steam only says so on an inventory read as its owner, so for a public read
 * this is usually absent — and absent has to mean "not known", never "not
 * locked". `market_tradable_restriction` gives the length of the lock in days
 * but not when it started, so it is not used to invent a date.
 */
export function tradableAfterFrom(description: SteamDescription): string | null {
  for (const entry of description.owner_descriptions ?? []) {
    const match = /Tradable After\s+(.+?)(?:\s*\(|$)/.exec(entry.value ?? "");
    if (!match) continue;
    const when = new Date((match[1] ?? "").trim());
    if (!Number.isNaN(when.getTime())) return when.toISOString();
  }
  return null;
}

/** Substitute the placeholders Steam leaves in an inspect link. */
export function inspectLinkFor(description: SteamDescription, steamId: string, assetId: string): string | null {
  const raw = description.actions?.find((a) => (a.link ?? "").startsWith("steam://rungame/"))?.link;
  if (!raw) return null;
  return raw.replace(/%owner_steamid%/g, steamId).replace(/%assetid%/g, assetId).replace(/%listingid%/g, "");
}

export interface ParsedInventory {
  items: ItemInput[];
  /** Assets whose description Steam did not send, so nothing is known about them. */
  unmatched: number;
}

/**
 * Turn one page of Steam's answer into items ready for intake.
 *
 * Stackables are collapsed here rather than left to intake: a Steam inventory
 * lists five Clutch Cases as five assets, and sending five one-copy intakes
 * would open five purchase lots for what was one holding.
 */
export function parseInventory(payload: SteamInventory, steamId: string): ParsedInventory {
  const byClass = new Map<string, SteamDescription>();
  for (const description of payload.descriptions ?? []) {
    byClass.set(`${description.classid}:${description.instanceid}`, description);
  }

  const items: ItemInput[] = [];
  const stacks = new Map<string, ItemInput>();
  let unmatched = 0;

  for (const asset of payload.assets ?? []) {
    const description = byClass.get(`${asset.classid}:${asset.instanceid}`);
    const marketHashName = description?.market_hash_name ?? description?.name;
    if (!description || !marketHashName) {
      unmatched++;
      continue;
    }

    const category = categoryFor(description);
    const quality = lower(tag(description, "Quality")?.internal_name);
    const amount = Math.max(1, Math.floor(Number(asset.amount ?? "1")) || 1);

    if (isStackable(category)) {
      const held = stacks.get(marketHashName);
      if (held) {
        held.quantity = (held.quantity ?? 0) + amount;
        continue;
      }
    }

    const { weapon, finish } = weaponAndFinish(marketHashName);
    const item: ItemInput = {
      marketHashName,
      category,
      weapon,
      finish,
      exterior: exteriorFor(description),
      rarity: rarityFor(description, category),
      collection: tag(description, "ItemSet")?.localized_tag_name ?? null,
      stattrak: quality === "strange" || marketHashName.includes("StatTrak™"),
      souvenir: quality === "tournament" || marketHashName.startsWith("Souvenir"),
      nameTag: nameTagFrom(description),
      quantity: amount,
      // A unique object keeps its asset id, so a second import recognises it
      // rather than adding a second copy. A stack cannot: its rows are pooled,
      // and one of five asset ids would be an arbitrary choice.
      assetId: isStackable(category) ? null : (asset.assetid ?? null),
      inspectLink: asset.assetid ? inspectLinkFor(description, steamId, asset.assetid) : null,
      tradableAfter: tradableAfterFrom(description),
      imageUrl: imageUrlFor(description.icon_url),
      stickers: stickersFrom(description),
      externalIds: { steam_classid: description.classid ?? "" },
    };

    items.push(item);
    if (isStackable(category)) stacks.set(marketHashName, item);
  }

  return { items, unmatched };
}

export class SteamInventoryError extends Error {}

/** A SteamID64 is seventeen digits and starts 7656119. */
export function isSteamId64(value: string): boolean {
  return /^7656119\d{10}$/.test(value.trim());
}

export const INVENTORY_URL = (steamId: string, count: number) =>
  `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=${count}`;

/**
 * Read a public inventory.
 *
 * Steam answers 403 for a private one and 429 when asked too often, and both
 * are ordinary states rather than faults, so each gets a sentence a person can
 * act on instead of a status code.
 */
export async function fetchInventory(
  steamId: string,
  fetchImpl: typeof fetch = fetch,
  count = 2000,
): Promise<SteamInventory> {
  if (!isSteamId64(steamId)) {
    throw new SteamInventoryError("That is not a SteamID64. It is seventeen digits and starts 7656119.");
  }
  const response = await fetchImpl(INVENTORY_URL(steamId.trim(), count), {
    headers: { Accept: "application/json" },
  });
  if (response.status === 403) {
    // Steam answers 403 for a private inventory — but so does anything between
    // here and Steam that refuses the request, and the two are identical from
    // this side. Naming only the first would send someone to change a privacy
    // setting that was never the problem.
    throw new SteamInventoryError(
      "That request was refused. Usually the inventory is not set to Public; it can also be a proxy or firewall blocking steamcommunity.com.",
    );
  }
  if (response.status === 429) {
    throw new SteamInventoryError("Steam is rate limiting this address. Wait a few minutes and try again.");
  }
  if (!response.ok) {
    throw new SteamInventoryError(`Steam answered ${response.status}.`);
  }
  const payload = (await response.json()) as SteamInventory;
  // Steam answers 200 with success: 0 for an empty or hidden inventory, so the
  // status alone is not enough to know it worked.
  if (payload.success === 0 || (!payload.assets && !payload.descriptions)) {
    throw new SteamInventoryError(payload.error || "Steam returned nothing for that inventory.");
  }
  return payload;
}
