import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newDraftId } from "@/lib/draft-id";
import { validDraftId } from "@/lib/scan-drafts";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What a page opened over plain http sees: random bytes, but no randomUUID. */
const insecure = () => ({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });

afterEach(() => vi.unstubAllGlobals());

describe("a scan draft's id in a browser without crypto.randomUUID", () => {
  it("is a version 4 UUID the server accepts", () => {
    for (let i = 0; i < 200; i++) {
      const id = newDraftId(insecure());
      expect(id).toMatch(V4);
      expect(validDraftId(id)).toBe(true);
    }
  });

  it("sets the version and variant bits and nothing else", () => {
    const fill = (value: (index: number) => number): Pick<Crypto, "getRandomValues"> => ({
      getRandomValues: ((bytes: Uint8Array) => { bytes.forEach((_, i) => { bytes[i] = value(i); }); return bytes; }) as Crypto["getRandomValues"],
    });
    expect(newDraftId(fill((i) => i))).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(newDraftId(fill(() => 0x00))).toBe("00000000-0000-4000-8000-000000000000");
    expect(newDraftId(fill(() => 0xff))).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newDraftId(insecure())));
    expect(ids.size).toBe(2000);
  });

  it("is what ScanFlow gets when the page's own crypto has no randomUUID", () => {
    // The page's global, as the browser gives it over http://<LAN address>.
    vi.stubGlobal("crypto", insecure());
    expect(() => (globalThis.crypto as Crypto).randomUUID()).toThrow();
    const id = newDraftId();
    expect(id).toMatch(V4);
    expect(validDraftId(id)).toBe(true);
  });

  it("still uses randomUUID where the browser has one", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555" as const);
    const getRandomValues = vi.fn();
    expect(newDraftId({ randomUUID, getRandomValues } as unknown as Crypto)).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
    // And the real one, on a secure page, makes ids the server accepts too.
    expect(validDraftId(newDraftId(webcrypto as unknown as Crypto))).toBe(true);
  });
});
