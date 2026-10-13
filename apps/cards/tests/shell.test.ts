import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildVersion } from "@collectcollect/core/build-id";
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
    const cards = serviceWorkerSource("collectcollect", "abc123");
    const skins = serviceWorkerSource("collectcollect-skins", "abc123");
    expect(cards).toContain("`collectcollect-shell-${VERSION}`");
    expect(skins).toContain("`collectcollect-skins-shell-${VERSION}`");
    expect(cards).not.toContain("__PREFIX__");
    expect(cards).toContain('url.pathname.startsWith("/api/")');
    expect(() => serviceWorkerSource("Bad Prefix", "abc123")).toThrow(/lowercase/);
    const res = serviceWorkerResponse("collectcollect", "abc123");
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/");
    expect(await res.text()).toBe(cards);
  });

  it("answers no request under /api/ itself, a navigation included: sign-in with Google comes back to one", () => {
    // The worker as a browser runs it, with what it reaches stubbed: whether it
    // calls respondWith is whether the request is the worker's to answer.
    const origin = "https://cards.example";
    let onFetch: ((event: unknown) => void) | undefined;
    const fetched: string[] = [];
    vm.runInNewContext(serviceWorkerSource("collectcollect", "abc123"), {
      URL,
      self: {
        location: new URL(`${origin}/sw.js`),
        addEventListener: (type: string, listener: (event: unknown) => void) => {
          if (type === "fetch") onFetch = listener;
        },
      },
      caches: { match: async () => undefined, open: async () => ({ put: async () => undefined }) },
      fetch: async (request: { url: string }) => {
        fetched.push(request.url);
        return new Response("from the network");
      },
    });
    const answers = (pathname: string, mode: string, method = "GET") => {
      let answered = false;
      onFetch?.({ request: { url: `${origin}${pathname}`, method, mode }, respondWith: () => { answered = true; } });
      return answered;
    };
    // The way back from Google, and the way there, reach the server as they are.
    expect(answers("/api/auth/google/callback?code=c&state=s", "navigate")).toBe(false);
    expect(answers("/api/auth/google/start?return=%2F", "navigate")).toBe(false);
    expect(answers("/api/cards", "cors")).toBe(false);
    // Pages are the worker's (network first, then the offline notice), and so are the hashed build files.
    expect(answers("/collection", "navigate")).toBe(true);
    expect(answers("/_next/static/chunks/app.js", "no-cors")).toBe(true);
    expect(fetched).toEqual([`${origin}/collection`]);
  });

  it("changes the worker with every build, so the offline shell is refreshed after a deploy", () => {
    // A worker whose bytes never changed was never reinstalled, so the offline
    // page and icons stayed at whatever the first install held.
    const first = serviceWorkerSource("collectcollect", "build-1");
    const second = serviceWorkerSource("collectcollect", "build-2");
    expect(first).toContain('const VERSION = "build-1";');
    expect(first).not.toContain("__VERSION__");
    expect(second).not.toBe(first);
    expect(() => serviceWorkerSource("collectcollect", "not a version")).toThrow(/version/);

    // The version is the build's own id where there is one...
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-build-"));
    try {
      fs.mkdirSync(path.join(dir, ".next"));
      fs.writeFileSync(path.join(dir, ".next", "BUILD_ID"), "zW3a_b-9\n");
      expect(buildVersion(dir)).toBe("zW3a_b-9");
      // ...and one steady id for the whole process where there is not (development).
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "collectcollect-nobuild-"));
      const dev = buildVersion(empty);
      expect(dev).toMatch(/^dev-[0-9a-f]{8}$/);
      expect(buildVersion(empty)).toBe(dev);
      expect(buildVersion(dir)).not.toBe(dev);
      fs.rmSync(empty, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
