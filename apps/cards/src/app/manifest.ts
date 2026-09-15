import type { MetadataRoute } from "next";
import { buildManifest } from "@collectcollect/core/manifest";

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest({
    name: "CollectCollect",
    shortName: "Collect",
    description: "Photograph, identify, and price your trading cards.",
    color: "#08090a",
    categories: ["productivity", "finance", "lifestyle"],
    shortcuts: [
      { name: "Scan a stack", shortName: "Scan", url: "/scan" },
      { name: "Add a card", shortName: "Add", url: "/add" },
      { name: "Collection", shortName: "Collection", url: "/collection" },
    ],
  });
}
