import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionStore } from "@collectcollect/core/sessions";

/**
 * The record of ended sessions: a small file the proxy reads on every request
 * and only re-parses when it has changed.
 */
describe("the session store", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sessions-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("revokes nothing until told to, then everything before now, then particular sessions", () => {
    const file = path.join(dir, "data", "sessions.json");
    const store = createSessionStore(() => file);
    expect(store.revoked()).toEqual({ before: 0, ids: [] });
    expect(fs.existsSync(file)).toBe(false);

    store.revokeAll(1000);
    expect(store.revoked()).toEqual({ before: 1001, ids: [] });
    expect(fs.existsSync(file)).toBe(true);

    store.revoke("aaaaaaaa-0000-4000-8000-000000000001", 5000, 1500);
    store.revoke("aaaaaaaa-0000-4000-8000-000000000001", 5000, 1500); // twice is once
    store.revoke("aaaaaaaa-0000-4000-8000-000000000002", 9000, 1500);
    expect(store.revoked().ids).toEqual(["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"]);
    // A record for a session that has run out on its own is dropped on the next change.
    store.revoke("aaaaaaaa-0000-4000-8000-000000000003", 9000, 6000);
    expect(store.revoked().ids).toEqual(["aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"]);
    expect(store.revoked().before).toBe(1001);
  });

  it("notices a change made by another process, and fails closed for a file it cannot read", () => {
    const file = path.join(dir, "sessions.json");
    const store = createSessionStore(file);
    store.revokeAll(1000);
    expect(store.revoked().before).toBe(1001);
    // Another process — the other worker, a person with an editor — writes it.
    fs.writeFileSync(file, JSON.stringify({ before: 7777, ids: [{ id: "bbbbbbbb-0000-4000-8000-000000000001", expires: 9e12 }] }));
    expect(store.revoked()).toEqual({ before: 7777, ids: ["bbbbbbbb-0000-4000-8000-000000000001"] });
    fs.writeFileSync(file, "{not json");
    expect(() => store.revoked()).toThrow(/Session records/);
    fs.rmSync(file);
    expect(() => store.revoked()).toThrow(/Session records/);
  });

  it("revokes all sessions rather than forgetting a live revocation at capacity", () => {
    const store = createSessionStore(path.join(dir, "sessions.json"));
    for (let i = 0; i < 250; i++) {
      store.revoke(`cccccccc-0000-4000-8000-${String(i).padStart(12, "0")}`, 1_000_000 + i, 0);
    }
    const { ids, before } = store.revoked();
    expect(before).toBe(1);
    expect(ids).toHaveLength(49);
  });
});
