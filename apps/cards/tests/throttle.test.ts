import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "@collectcollect/core/atomic-write";
import { BusyError, createGate } from "@collectcollect/core/gate";
import { clientKey, createThrottle } from "@collectcollect/core/throttle";

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

const from = (ip: string | null) =>
  new Request("http://localhost/x", { method: "POST", headers: ip ? { "x-forwarded-for": ip } : {} });

describe("one at a time", () => {
  it("refuses a second caller while the first is running, then opens again", async () => {
    const gate = createGate("busy");
    let release!: () => void;
    const first = gate.run(() => new Promise<string>((resolve) => (release = () => resolve("done"))));
    expect(gate.busy).toBe(true);
    await expect(gate.run(async () => "second")).rejects.toBeInstanceOf(BusyError);
    await expect(gate.run(async () => "second")).rejects.toThrow("busy");
    release();
    expect(await first).toBe("done");
    expect(gate.busy).toBe(false);
    expect(await gate.run(async () => "third")).toBe("third");
  });

  it("opens again after the work throws", async () => {
    const gate = createGate();
    await expect(gate.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(gate.busy).toBe(false);
    expect(await gate.run(async () => 1)).toBe(1);
  });
});

describe("who is asking", () => {
  it("is everyone at once unless a proxy is trusted to say otherwise", () => {
    // Anyone can send X-Forwarded-For. Without a proxy in front, believing it
    // would let every client reset its own limit with one header.
    expect(clientKey(from("203.0.113.9"))).toBe("local");
    expect(clientKey(from(null))).toBe("local");
    process.env.TRUST_PROXY = "1";
    expect(clientKey(from("203.0.113.9, 10.0.0.1"))).toBe("203.0.113.9");
    expect(clientKey(from(null))).toBe("local");
    process.env.TRUST_PROXY = "no";
    expect(clientKey(from("203.0.113.9"))).toBe("local");
  });
});

describe("a per-route limit", () => {
  it("lets a window's worth through and refuses the next with a Retry-After", async () => {
    const throttle = createThrottle(3, 60_000, "tries");
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(throttle.check(from(null), t0 + i)).toBeNull();
    const refused = throttle.check(from(null), t0 + 10);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("Retry-After")).toBe("60");
    expect(((await refused!.json()) as { error: string }).error).toMatch(/Too many tries/);
    // The window slides: once the first request ages out, one more fits.
    expect(throttle.check(from(null), t0 + 60_000)).toBeNull();
    expect(throttle.check(from(null), t0 + 60_000)?.status).toBe(429);
  });

  it("counts clients apart when a proxy is trusted", () => {
    process.env.TRUST_PROXY = "true";
    const throttle = createThrottle(1, 60_000);
    expect(throttle.check(from("203.0.113.1"), 0)).toBeNull();
    expect(throttle.check(from("203.0.113.1"), 1)?.status).toBe(429);
    expect(throttle.check(from("203.0.113.2"), 1)).toBeNull();
    throttle.reset();
    expect(throttle.check(from("203.0.113.1"), 2)).toBeNull();
  });
});

describe("writing a file atomically", () => {
  it("leaves the file whole and no temporary beside it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-atomic-"));
    const file = path.join(dir, "note.md");
    writeFileAtomic(file, "first");
    writeFileAtomic(file, "second");
    expect(fs.readFileSync(file, "utf8")).toBe("second");
    expect(fs.readdirSync(dir)).toEqual(["note.md"]);
    // A failed rename does not leave its temporary file behind either.
    fs.mkdirSync(path.join(dir, "taken"));
    fs.writeFileSync(path.join(dir, "taken", "x"), "");
    expect(() => writeFileAtomic(path.join(dir, "taken"), "x")).toThrow();
    expect(fs.readdirSync(dir).sort()).toEqual(["note.md", "taken"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
