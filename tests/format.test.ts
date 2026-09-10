import { describe, expect, it } from "vitest";
import { httpUrl, imageSrc } from "@/lib/format";

describe("httpUrl", () => {
  it("passes http(s) through and refuses everything else", () => {
    expect(httpUrl("https://prices.example/card/1")).toBe("https://prices.example/card/1");
    expect(httpUrl(" http://prices.example/card/1 ")).toBe("http://prices.example/card/1");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(httpUrl("file:///etc/passwd")).toBeNull();
    expect(httpUrl("intent://evil#Intent;scheme=http;end")).toBeNull();
    expect(httpUrl("/relative/path")).toBeNull();
    expect(httpUrl("")).toBeNull();
    expect(httpUrl(null)).toBeNull();
    expect(httpUrl(42)).toBeNull();
  });
});

describe("imageSrc", () => {
  it("prefers the stored photo", () => {
    expect(imageSrc({ imagePath: "abc.jpg", referenceImageUrl: "https://img.example/a.png" })).toBe("/api/uploads/abc.jpg");
  });

  it("only falls back to an outside URL that is safe to render", () => {
    expect(imageSrc({ imagePath: null, referenceImageUrl: "https://img.example/a.png" })).toBe("https://img.example/a.png");
    // A restored database can carry anything in this column.
    expect(imageSrc({ imagePath: null, referenceImageUrl: "javascript:alert(1)" })).toBeNull();
    expect(imageSrc({ imagePath: null, referenceImageUrl: null })).toBeNull();
  });
});
