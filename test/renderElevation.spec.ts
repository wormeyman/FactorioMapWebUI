import { describe, expect, it } from "vite-plus/test";
import { renderElevation, WATER_RGBA, LAND_RGBA } from "../src/noise/preview/renderElevation";
import { makeElevationLakes } from "../src/noise/expressions/elevationLakes";
import { makeElevationNauvis } from "../src/noise/expressions/elevationNauvis";

describe("renderElevation", () => {
  it("produces an ImageData of the requested size", () => {
    const img = renderElevation({ seed0: 123456, width: 8, height: 6 });
    expect(img.width).toBe(8);
    expect(img.height).toBe(6);
    expect(img.data.length).toBe(8 * 6 * 4);
  });

  it("colors each pixel by the sign of elevation at its world tile", () => {
    const width = 4;
    const height = 4;
    const originX = -1;
    const originY = 2;
    const tilesPerPixel = 3;
    const img = renderElevation({ seed0: 123456, width, height, originX, originY, tilesPerPixel });
    const evalAt = makeElevationLakes({ seed0: 123456 });
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const wx = originX + px * tilesPerPixel;
        const wy = originY + py * tilesPerPixel;
        const expected = evalAt(wx, wy) < 0 ? WATER_RGBA : LAND_RGBA;
        const o = (py * width + px) * 4;
        expect([img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]).toEqual(expected);
      }
    }
  });
});

describe("renderElevation map-type dispatch", () => {
  const width = 4;
  const height = 4;
  const originX = -1;
  const originY = 2;
  const tilesPerPixel = 3;

  it("uses the nauvis factory when mapType is 'nauvis'", () => {
    const img = renderElevation({
      seed0: 123456,
      width,
      height,
      originX,
      originY,
      tilesPerPixel,
      mapType: "nauvis",
    });
    const evalAt = makeElevationNauvis({ seed0: 123456 });
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const wx = originX + px * tilesPerPixel;
        const wy = originY + py * tilesPerPixel;
        const expected = evalAt(wx, wy) < 0 ? WATER_RGBA : LAND_RGBA;
        const o = (py * width + px) * 4;
        expect([img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]).toEqual(expected);
      }
    }
  });

  it("defaults to the lakes factory when mapType is omitted", () => {
    const a = renderElevation({ seed0: 123456, width, height, originX, originY, tilesPerPixel });
    const b = renderElevation({
      seed0: 123456,
      width,
      height,
      originX,
      originY,
      tilesPerPixel,
      mapType: "lakes",
    });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
