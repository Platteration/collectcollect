import { describe, expect, it } from "vitest";
import { localDateInput } from "@/lib/format";

describe("today's date for a form", () => {
  it("is the viewer's date, not UTC's", () => {
    // Half past eleven at night on 31 January in UTC is already 1 February an hour east...
    expect(localDateInput(new Date(Date.UTC(2026, 0, 31, 23, 30)), -60)).toBe("2026-02-01");
    // ...and two in the morning on 1 February in UTC is still 31 January in New York.
    expect(localDateInput(new Date(Date.UTC(2026, 1, 1, 2, 0)), 300)).toBe("2026-01-31");
    expect(localDateInput(new Date(Date.UTC(2026, 1, 1, 2, 0)), 0)).toBe("2026-02-01");
  });
});
