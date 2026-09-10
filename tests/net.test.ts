import { afterEach, describe, expect, it, vi } from "vitest";
import { isPrivateAddress, outboundRefusal } from "@/lib/net";
import { deliver } from "@/lib/alerts";
import { DEFAULT_SETTINGS, type Alert } from "@/lib/types";

describe("isPrivateAddress", () => {
  it("knows the addresses a webhook must not reach", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.7",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.20",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fd00::1", // unique local
      "fe80::1", // link local
      "::ffff:127.0.0.1", // v4 written as v6
      "[::1]",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("leaves ordinary public addresses alone", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "203.0.113.9", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("outboundRefusal", () => {
  it("refuses this machine and the network around it without resolving anything", async () => {
    expect(await outboundRefusal("http://127.0.0.1:9200/_search")).toMatch(/private network/);
    expect(await outboundRefusal("http://169.254.169.254/latest/meta-data/")).toMatch(/private network/);
    expect(await outboundRefusal("http://[::1]:3000/api/backup")).toMatch(/private network/);
    expect(await outboundRefusal("http://localhost:3000/")).toMatch(/this machine/);
    expect(await outboundRefusal("http://db.localhost/")).toMatch(/this machine/);
  });

  it("refuses anything that is not an http(s) URL", async () => {
    expect(await outboundRefusal("file:///etc/passwd")).toBeTruthy();
    expect(await outboundRefusal("not a url")).toBeTruthy();
  });
});

const alert: Alert = {
  id: 1,
  kind: "price_move",
  cardId: 1,
  title: "up",
  body: "body",
  createdAt: "2026-01-01T00:00:00.000Z",
  readAt: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("webhook delivery", () => {
  it("never sends to a private address", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await deliver(alert, { ...DEFAULT_SETTINGS, alertWebhookUrl: "http://127.0.0.1:8080/hook" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("does nothing at all when no webhook is configured", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    await deliver(alert, DEFAULT_SETTINGS);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
