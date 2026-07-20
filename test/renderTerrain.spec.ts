import { describe, expect, it } from "vite-plus/test";
import { renderTerrain } from "../src/noise/preview/renderTerrain";
import { makeTileResolver } from "../src/noise/tiles/resolve";

describe("renderTerrain", () => {
  it("produces an ImageData of the requested size", () => {
    const img = renderTerrain({ seed0: 123456, width: 8, height: 6 });
    expect(img.width).toBe(8);
    expect(img.height).toBe(6);
    expect(img.data.length).toBe(8 * 6 * 4);
  });

  it("a deep-water world point renders the deepwater color", () => {
    // World point (2742, 8459), seed 123456: makeElevationNauvis ~= -207.9,
    // strongly submerged - resolveTile confirms "deepwater" there.
    const img = renderTerrain({ seed0: 123456, width: 1, height: 1, originX: 2742, originY: 8459 });
    expect([img.data[0], img.data[1], img.data[2], img.data[3]]).toEqual([38, 64, 73, 255]);
  });

  it("a land pixel matches the full tile resolver's color", () => {
    // World point (-1200, -1162), seed 123456: makeElevationNauvis = +2.34
    // (LAND) - reused from renderElevation.spec.ts's known land point.
    const seed0 = 123456;
    const x = -1200;
    const y = -1162;
    const resolve = makeTileResolver({ seed0 });
    const expected = resolve(x, y).color;

    const img = renderTerrain({ seed0, width: 1, height: 1, originX: x, originY: y });
    expect([img.data[0], img.data[1], img.data[2], img.data[3]]).toEqual(expected);
  });

  it("early-out correctness: render matches the full resolver over a grid spanning water and land", () => {
    // 40x40 grid (1600 points) over a wide window; empirically 403 water/deepwater
    // + 1197 land points, including at least one near-threshold ambiguous point
    // ((3900,-1800): elevation ~= -0.0004, water_base ~= 0.04 - well below the
    // early-out threshold, so it correctly falls through to the full resolver
    // and resolves to a land tile ("dry-dirt") despite negative elevation - the
    // coastline-shift behavior the design doc documents). This is the key safety
    // test: if the early-out threshold were unsafe, some pixel here would win a
    // different tile than the full resolver and this loop would catch it.
    const seed0 = 123456;
    const width = 40;
    const height = 40;
    const originX = -6000;
    const originY = -6000;
    const tilesPerPixel = 300;

    const img = renderTerrain({ seed0, width, height, originX, originY, tilesPerPixel });
    const resolve = makeTileResolver({ seed0 });

    let waterCount = 0;
    let landCount = 0;
    for (let py = 0; py < height; py++) {
      const wy = originY + py * tilesPerPixel;
      for (let px = 0; px < width; px++) {
        const wx = originX + px * tilesPerPixel;
        const expected = resolve(wx, wy);
        if (expected.name === "water" || expected.name === "deepwater") {
          waterCount++;
        } else {
          landCount++;
        }

        const o = (py * width + px) * 4;
        const actual = [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
        expect(actual, `mismatch at (${wx},${wy}), expected tile "${expected.name}"`).toEqual(
          expected.color,
        );
      }
    }

    // Sanity: the grid actually exercises both the early-out path and the
    // full-resolver fallback path, not just one of them.
    expect(waterCount).toBeGreaterThan(0);
    expect(landCount).toBeGreaterThan(0);
  });
});
