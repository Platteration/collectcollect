import type { MetadataRoute } from "next";
import { buildManifest } from "@collectcollect/core/manifest";

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest({
    name: "CollectCollect Skins",
    shortName: "Skins",
    description: "Track what your CS2 inventory cost, what it is worth, and where it would sell for most.",
    color: "#0b0e13",
    categories: ["productivity", "finance", "games"],
    shortcuts: [
      { name: "Where to sell", shortName: "Sell", url: "/spread" },
      { name: "Add an item", shortName: "Add", url: "/add" },
      { name: "Inventory", shortName: "Inventory", url: "/inventory" },
    ],
  });
}
