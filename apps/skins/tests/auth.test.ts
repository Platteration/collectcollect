import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createToken, verifyToken } from "@/lib/auth";
import { dataDir } from "@/lib/paths";

afterEach(() => {
  delete process.env.SKINS_APP_PASSWORD;
  delete process.env.SKINS_APP_SECRET;
});

/** The gate is shared; this holds the skins wiring to it: its own variable, its own key file. */
describe("the skins password gate", () => {
  it("signs sessions with a random key kept beside the inventory", async () => {
    process.env.SKINS_APP_PASSWORD = "hunter2";
    const file = path.join(dataDir(), "session-secret");
    expect(fs.existsSync(file)).toBe(false);
    const token = await createToken();
    expect(fs.readFileSync(file, "utf8").trim()).toMatch(/^[a-f0-9]{64}$/);
    expect(await verifyToken(token)).toBe(true);
    // A different key refuses the token: the key, not the password, is what signs.
    fs.writeFileSync(file, `${"b".repeat(48)}\n`);
    expect(await verifyToken(token)).toBe(false);
  });
});
