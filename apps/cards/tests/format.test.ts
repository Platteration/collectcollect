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

describe("a picture or a link from outside", () => {
  it("is drawn only when it is an http(s) URL, however it reached the database", async () => {
    const { httpUrl, imageSrc } = await import("@/lib/format");
    // A restored database is not saved through the app, so the write path's
    // check has never seen it.
    for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "  ", "not a url"]) {
      expect(httpUrl(url)).toBeNull();
      expect(imageSrc({ imagePath: null, referenceImageUrl: url })).toBeNull();
    }
    expect(httpUrl(42)).toBeNull();
    expect(imageSrc({ imagePath: null, referenceImageUrl: "https://images.example/card.png" })).toBe("https://images.example/card.png");
    expect(imageSrc({ imagePath: "0a1b2c3d-0000-4000-8000-000000000000.jpg", referenceImageUrl: "javascript:alert(1)" })).toBe("/api/uploads/0a1b2c3d-0000-4000-8000-000000000000.jpg");
  });
});
