import type { MetadataRoute } from "next";

/** Makes the app installable on a phone or desktop, opening without browser chrome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CollectCollect Skins",
    short_name: "Skins",
    description: "Track what your CS2 inventory cost, what it is worth, and where it would sell for most.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0e13",
    theme_color: "#0b0e13",
    categories: ["productivity", "finance", "games"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Where to sell", short_name: "Sell", url: "/spread" },
      { name: "Add an item", short_name: "Add", url: "/add" },
      { name: "Inventory", short_name: "Inventory", url: "/inventory" },
    ],
  };
}
