import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { widgetEngine } from "./widgets";

const solid = (r: number, g: number, b: number, format: "png" | "jpeg" = "png") =>
  sharp({ create: { width: 20, height: 20, channels: 3, background: { r, g, b } } })[format]().toBuffer();

describe("a photo's colour", () => {
  const { images } = widgetEngine();

  it("is the middle of the picture, lifted so a dark one still shows", async () => {
    expect(await images.dominantColor(await solid(200, 40, 40))).toBe("#ff3333");
    expect(await images.dominantColor(await solid(10, 10, 10))).toBe("#131313");
  });

  it("is read off a greyscale picture too", async () => {
    const grey = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 100, g: 100, b: 100 } } }).toColourspace("b-w").jpeg().toBuffer();
    // A JPEG is lossy, so the grey may be a step either side of the 100 it was made from.
    expect(await images.dominantColor(grey)).toMatch(/^#(?:b[d-f]){3}$/);
  });

  it("is nothing for bytes that are not a picture", async () => {
    expect(await images.dominantColor(Buffer.from("not a picture"))).toBeNull();
  });
});
