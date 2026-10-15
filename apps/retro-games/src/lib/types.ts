/**
 * What a retro game is, as far as this app is concerned.
 *
 * The lists here are the vocabulary of the schema: the enum options the form
 * offers, the filters on the collection page, the labels in the Markdown
 * mirror, and the words the identification prompt is allowed to answer with.
 */

export const PLATFORMS = {
  nes: "NES",
  snes: "SNES",
  n64: "Nintendo 64",
  gamecube: "GameCube",
  wii: "Wii",
  wii_u: "Wii U",
  switch: "Switch",
  game_boy: "Game Boy",
  game_boy_color: "Game Boy Color",
  gba: "Game Boy Advance",
  ds: "Nintendo DS",
  "3ds": "Nintendo 3DS",
  virtual_boy: "Virtual Boy",
  master_system: "Master System",
  genesis: "Genesis / Mega Drive",
  sega_cd: "Sega CD",
  "32x": "32X",
  saturn: "Saturn",
  dreamcast: "Dreamcast",
  game_gear: "Game Gear",
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  ps4: "PlayStation 4",
  psp: "PSP",
  vita: "PS Vita",
  xbox: "Xbox",
  xbox_360: "Xbox 360",
  xbox_one: "Xbox One",
  atari_2600: "Atari 2600",
  atari_5200: "Atari 5200",
  atari_7800: "Atari 7800",
  jaguar: "Atari Jaguar",
  lynx: "Atari Lynx",
  neo_geo: "Neo Geo AES",
  neo_geo_pocket: "Neo Geo Pocket Color",
  tg16: "TurboGrafx-16 / PC Engine",
  "3do": "3DO",
  colecovision: "ColecoVision",
  intellivision: "Intellivision",
  pc: "PC",
  other: "Other",
} as const;
export type Platform = keyof typeof PLATFORMS;
export const PLATFORM_IDS = Object.keys(PLATFORMS) as Platform[];

export const REGIONS = { ntsc_u: "NTSC-U", pal: "PAL", ntsc_j: "NTSC-J", other: "Other" } as const;
export type Region = keyof typeof REGIONS;
export const REGION_IDS = Object.keys(REGIONS) as Region[];

export const COMPLETENESS = { loose: "Loose", cib: "Complete in box", sealed: "Sealed", graded: "Graded" } as const;
export type Completeness = keyof typeof COMPLETENESS;
export const COMPLETENESS_IDS = Object.keys(COMPLETENESS) as Completeness[];

/** The PriceCharting price a copy of each completeness is valued from. */
export const TIER_KEY: Record<Completeness, string> = { loose: "Loose", cib: "CIB", sealed: "New", graded: "Graded" };
export const TIER_KEYS = ["Loose", "CIB", "New", "Graded"];

export const COMPANIES = { none: "Not graded", wata: "WATA", vga: "VGA", cgc: "CGC" } as const;
export type Company = keyof typeof COMPANIES;
export const COMPANY_IDS = Object.keys(COMPANIES) as Company[];

export const CONDITIONS = { mint: "Mint", near_mint: "Near mint", very_good: "Very good", good: "Good", fair: "Fair", poor: "Poor" } as const;
export type Condition = keyof typeof CONDITIONS;
export const CONDITION_IDS = Object.keys(CONDITIONS) as Condition[];

export interface Game {
  title: string;
  platform: Platform;
  region: Region;
  releaseYear: number | null;
  publisher: string | null;
  completeness: Completeness;
  gradingCompany: Company;
  /** As printed on the slab: "9.4 A+" for WATA, "85" for VGA, "9.6" for CGC. */
  grade: string | null;
  certNumber: string | null;
  boxCondition: Condition | null;
  manualCondition: Condition | null;
  /** The cartridge or disc. */
  mediaCondition: Condition | null;
  /** "Player's Choice", "Greatest Hits", "Rev-A", a regional variant cover. */
  variant: string | null;
}

export interface GameSettings {
  /** What sending one game to WATA, VGA or CGC costs, all in. */
  gradingFee: number;
  /** "Ready to grade" needs at least this much upside after the fee... */
  readyMinUpside: number;
  /** ...and at least this much of the raw value, in percent. */
  readyMinUpsidePercent: number;
  /** A graded copy is worth this many times the raw copy, by the raw copy's completeness, when no graded price is known. */
  gradeMultipliers: Record<string, number>;
  /** A copy's tier price is scaled by the condition of what it consists of. */
  conditionMultipliers: Record<string, number>;
}

export const DEFAULT_SETTINGS: GameSettings = {
  gradingFee: 100,
  readyMinUpside: 100,
  readyMinUpsidePercent: 30,
  gradeMultipliers: { New: 2.0, CIB: 1.4, Loose: 1.2 },
  conditionMultipliers: { mint: 1.15, near_mint: 1.1, very_good: 1, good: 0.9, fair: 0.7, poor: 0.5 },
};

/** What a price source is asked. */
export interface GameQuery {
  title: string;
  platform: Platform;
  region: Region;
  releaseYear: number | null;
  variant: string | null;
  externalIds: Record<string, string>;
}

/** The console name PriceCharting files a platform under, which carries the region as a prefix. */
export function priceChartingConsole(platform: Platform, region: Region): string | null {
  const base: Partial<Record<Platform, string>> = {
    nes: "NES",
    snes: "Super Nintendo",
    n64: "Nintendo 64",
    gamecube: "Gamecube",
    wii: "Wii",
    wii_u: "Wii U",
    switch: "Nintendo Switch",
    game_boy: "GameBoy",
    game_boy_color: "GameBoy Color",
    gba: "GameBoy Advance",
    ds: "Nintendo DS",
    "3ds": "Nintendo 3DS",
    virtual_boy: "Virtual Boy",
    master_system: "Sega Master System",
    genesis: "Sega Genesis",
    sega_cd: "Sega CD",
    "32x": "Sega 32X",
    saturn: "Sega Saturn",
    dreamcast: "Sega Dreamcast",
    game_gear: "Sega Game Gear",
    ps1: "Playstation",
    ps2: "Playstation 2",
    ps3: "Playstation 3",
    ps4: "Playstation 4",
    psp: "PSP",
    vita: "Playstation Vita",
    xbox: "Xbox",
    xbox_360: "Xbox 360",
    xbox_one: "Xbox One",
    atari_2600: "Atari 2600",
    atari_5200: "Atari 5200",
    atari_7800: "Atari 7800",
    jaguar: "Jaguar",
    lynx: "Atari Lynx",
    neo_geo: "Neo Geo AES",
    neo_geo_pocket: "Neo Geo Pocket Color",
    tg16: "TurboGrafx-16",
    "3do": "3DO",
    colecovision: "Colecovision",
    intellivision: "Intellivision",
    pc: "PC Games",
  };
  const name = base[platform];
  if (!name) return null;
  if (region === "pal") return platform === "genesis" ? "PAL Sega Mega Drive" : `PAL ${name}`;
  if (region === "ntsc_j") {
    if (platform === "nes") return "Famicom";
    if (platform === "snes") return "Super Famicom";
    if (platform === "genesis") return "JP Sega Mega Drive";
    if (platform === "tg16") return "PC Engine";
    return `JP ${name}`;
  }
  return name;
}
