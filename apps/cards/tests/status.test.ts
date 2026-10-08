import { afterEach, describe, expect, it, vi } from "vitest";
import { providerStatuses } from "@/lib/status";

describe("the data sources Settings lists", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lists the PSA cert lookup, configured when the server holds a token, with no test button", () => {
    const before = providerStatuses().find((p) => p.id === "psa");
    expect(before).toMatchObject({ label: "PSA cert lookup", configured: false, optional: true, testable: false });
    expect(before?.note).toMatch(/PSA_API_TOKEN/);
    vi.stubEnv("PSA_API_TOKEN", "t");
    expect(providerStatuses().find((p) => p.id === "psa")?.configured).toBe(true);
    // Every price source still offers its test.
    for (const p of providerStatuses()) if (p.id !== "psa") expect(p.testable, p.id).toBe(true);
  });
});
