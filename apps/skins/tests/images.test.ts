import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { IMAGE_SOURCES, shownImage } from "@/lib/images";
import { proxy } from "@/proxy";

describe("which item pictures a page draws", () => {
  it("draws one from either of Steam's image hosts, as given", () => {
    expect(shownImage("https://community.cloudflare.steamstatic.com/economy/image/abc/360fx360f")).toBe("https://community.cloudflare.steamstatic.com/economy/image/abc/360fx360f");
    expect(shownImage("https://steamcommunity-a.akamaihd.net/economy/image/abc")).toBe("https://steamcommunity-a.akamaihd.net/economy/image/abc");
    // The default port written out is the same host.
    expect(shownImage("https://steamcommunity-a.akamaihd.net:443/economy/image/abc")).toBe("https://steamcommunity-a.akamaihd.net/economy/image/abc");
  });

  it("draws nothing the policy would refuse, so the page shows No image instead of a broken one", () => {
    for (const url of [
      "https://images.example.com/ak47.png",
      "https://community.cloudflare.steamstatic.com.attacker.example/x.png",
      "https://attacker.example/community.cloudflare.steamstatic.com/x.png",
      "http://community.cloudflare.steamstatic.com/economy/image/abc",
      "https://community.cloudflare.steamstatic.com:8443/economy/image/abc",
      "https://user:pass@community.cloudflare.steamstatic.com/economy/image/abc",
      "data:image/png;base64,iVBORw0KGgo=",
      "javascript:alert(1)",
      "/icons/icon-192.png",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(shownImage(url), String(url)).toBeNull();
    }
  });

  it("is the list the policy the app serves names in img-src, and nothing more", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/", { headers: { host: "localhost:3000" } }));
    const imgSrc = (res.headers.get("Content-Security-Policy") ?? "").split("; ").find((d) => d.startsWith("img-src "));
    expect(imgSrc).toBe(`img-src 'self' ${IMAGE_SOURCES.join(" ")}`);
  });
});
