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

/** Sign-in with Google, through the skins app's own gate: its own variables, its own cookies, its own key file. */
describe("the skins app's sign-in with Google", () => {
  const CLIENT = { id: "skins-client.apps.googleusercontent.com", secret: "skins-client-secret" };
  const NAMES = ["APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ALLOWED_SUBS", "GOOGLE_ALLOWED_EMAILS"];
  afterEach(() => {
    for (const prefix of ["", "SKINS_"]) for (const name of NAMES) delete process.env[`${prefix}${name}`];
  });

  it("reads SKINS_APP_URL and SKINS_GOOGLE_*, never the card app's, and signs a skins session", async () => {
    const { auth } = await import("@/lib/auth");
    const { createAuthRoutes } = await import("@collectcollect/core/auth-route");
    const { authorize, createFakeGoogle } = await import("../../../scripts/fake-google.mjs");
    // The card app's variables leave this gate alone.
    process.env.APP_URL = "https://cards.example";
    process.env.GOOGLE_CLIENT_ID = CLIENT.id;
    process.env.GOOGLE_CLIENT_SECRET = CLIENT.secret;
    process.env.GOOGLE_ALLOWED_SUBS = "1001";
    expect(auth.authEnabled()).toBe(false);

    process.env.SKINS_APP_URL = "https://skins.example";
    process.env.SKINS_GOOGLE_CLIENT_ID = CLIENT.id;
    process.env.SKINS_GOOGLE_CLIENT_SECRET = CLIENT.secret;
    process.env.SKINS_GOOGLE_ALLOWED_EMAILS = "owner@example.com";
    expect(auth.authEnabled()).toBe(true);
    expect(auth.passwordEnabled()).toBe(false);
    expect(auth.GOOGLE_COOKIE).toBe("__Host-collectcollect-skins-oauth");

    const google = await createFakeGoogle({ clientId: CLIENT.id, clientSecret: CLIENT.secret });
    const routes = createAuthRoutes(auth, { fetch: google.fetch });
    const start = await routes.googleStart(new Request("https://skins.example/api/auth/google/start?return=%2Finventory"));
    const flow = /^__Host-collectcollect-skins-oauth=([^;]+)/.exec(start.headers.getSetCookie()[0] ?? "")?.[1] ?? "";
    const url = authorize(start.headers.get("location") ?? "", { sub: "1001", email: "owner@example.com", email_verified: true }, { clientId: CLIENT.id });
    expect(new URL(url).origin).toBe("https://skins.example");
    const back = await routes.googleCallback(new Request(url, { headers: { cookie: `__Host-collectcollect-skins-oauth=${flow}` } }));
    expect(back.headers.get("location")).toBe("https://skins.example/inventory");
    const session = back.headers.getSetCookie().find((c) => c.startsWith("cc_skins_session="));
    expect(session).toMatch(/; Secure$/);
    const token = /^cc_skins_session=([^;]+)/.exec(session ?? "")?.[1];
    expect(await verifyToken(token)).toBe(true);
    // Signed with the skins key file, which the sign-in made beside the inventory.
    expect(fs.readFileSync(path.join(dataDir(), "session-secret"), "utf8").trim()).toMatch(/^[a-f0-9]{64}$/);
  });
});
