import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { PUT } from "@/app/api/settings/route";
import { DEFAULT_SETTINGS } from "@/lib/types";

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

describe("saving settings", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("changes only what it was given", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, spreadMinAmount: 3, ownerName: "Ada" });
    const res = await put({ spreadMinAmount: 5 });
    expect(res.status).toBe(200);
    expect(getSettings()).toMatchObject({ spreadMinAmount: 5, ownerName: "Ada" });
  });

  it("refuses a value that is not a number, and changes nothing", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, stattrakMultiplier: 1.3 });
    const res = await put({ stattrakMultiplier: null });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/StatTrak/);
    expect(getSettings().stattrakMultiplier).toBe(1.3);
  });

  it("refuses a fee that would mean a sale pays nothing", async () => {
    const res = await put({ marketFees: { steam: 1 } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/market fees \(steam\)/);
    expect(getSettings().marketFees.steam).toBe(DEFAULT_SETTINGS.marketFees.steam);
  });

  it("leaves markets and wear tiers it was not told about alone", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, marketFees: { ...DEFAULT_SETTINGS.marketFees, csfloat: 0.01 } });
    expect((await put({ marketFees: { skinport: 0.1 } })).status).toBe(200);
    expect(getSettings().marketFees).toMatchObject({ skinport: 0.1, csfloat: 0.01 });
  });

  it("refuses a webhook that is not a URL rather than quietly switching alerts off", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, alertWebhookUrl: "https://hooks.example/abc" });
    for (const bad of ["not a url", "ftp://hooks.example/x", "javascript:alert(1)", 42, null]) {
      const res = await put({ alertWebhookUrl: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/webhook/i);
      expect(getSettings().alertWebhookUrl).toBe("https://hooks.example/abc");
    }
    // Blank is how it is switched off on purpose.
    expect((await put({ alertWebhookUrl: "" })).status).toBe(200);
    expect(getSettings().alertWebhookUrl).toBe("");
  });

  it("refuses an owner name that is not text", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, ownerName: "Ada" });
    const res = await put({ ownerName: ["A"] });
    expect(res.status).toBe(400);
    expect(getSettings().ownerName).toBe("Ada");
  });

  it("says so when the body is not JSON", async () => {
    const res = await PUT(new Request("http://localhost/api/settings", { method: "PUT", body: "{nope" }));
    expect(res.status).toBe(400);
  });
});
