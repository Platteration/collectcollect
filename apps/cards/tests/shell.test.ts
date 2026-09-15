import { describe, expect, it } from "vitest";
import { buildManifest } from "@collectcollect/core/manifest";
import { serviceWorkerResponse, serviceWorkerSource } from "@collectcollect/core/service-worker";

describe("the installable shell shared by both apps", () => {
  it("builds a manifest with the app's words and the shared icons", () => {
    const m = buildManifest({
      name: "Test",
      shortName: "T",
      description: "d",
      color: "#010203",
      categories: ["x"],
      shortcuts: [{ name: "Go", shortName: "Go", url: "/go" }],
    });
    expect(m).toMatchObject({ name: "Test", short_name: "T", display: "standalone", theme_color: "#010203", background_color: "#010203" });
    expect(m.icons?.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
    expect(m.shortcuts).toEqual([{ name: "Go", short_name: "Go", url: "/go" }]);
  });

  it("names the worker's caches after the app and nothing else, and never caches the API", async () => {
    const cards = serviceWorkerSource("collectcollect");
    const skins = serviceWorkerSource("collectcollect-skins");
    expect(cards).toContain("`collectcollect-shell-${VERSION}`");
    expect(skins).toContain("`collectcollect-skins-shell-${VERSION}`");
    expect(cards).not.toContain("__PREFIX__");
    expect(cards).toContain('url.pathname.startsWith("/api/")');
    expect(() => serviceWorkerSource("Bad Prefix")).toThrow(/lowercase/);
    const res = serviceWorkerResponse("collectcollect");
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/");
    expect(await res.text()).toBe(cards);
  });
});
