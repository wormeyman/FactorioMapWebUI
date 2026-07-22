import { describe, expect, it } from "vite-plus/test";
import { WATER_TILE_COLORS } from "../src/noise/preview/renderResources";
import { TREE_MAP_COLOR, TREE_MAX_ALPHA, renderTrees } from "../src/noise/preview/renderTrees";
import { makeTreeDensity } from "../src/noise/trees/treeField";

const solid = (w: number, h: number, rgb: readonly [number, number, number]): ImageData => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
};

const GRASS: readonly [number, number, number] = [99, 122, 44];

describe("renderTrees", () => {
  it("uses the game's own tree chart color and alpha", () => {
    // core/prototypes/utility-constants.lua:201 -
    //   default_color_by_type["tree"] = {0.19, 0.39, 0.19, 0.40}
    expect(TREE_MAP_COLOR).toEqual([48, 99, 48]);
    expect(TREE_MAX_ALPHA).toBeCloseTo(0.4, 12);
  });

  it("blends toward the tree color in proportion to density", () => {
    const img = solid(16, 16, GRASS);
    renderTrees(img, { seed0: 123456, originX: 0, originY: 0, tilesPerPixel: 1 });
    const density = makeTreeDensity({ seed0: 123456 });
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const o = (py * 16 + px) * 4;
        const a = TREE_MAX_ALPHA * density(px, py);
        for (let c = 0; c < 3; c++) {
          const expected = Math.round(GRASS[c] * (1 - a) + TREE_MAP_COLOR[c] * a);
          expect(img.data[o + c], `px(${px},${py}) ch${c}`).toBe(expected);
        }
        expect(img.data[o + 3]).toBe(255);
      }
    }
  });

  it("leaves water pixels untouched", () => {
    for (const water of WATER_TILE_COLORS) {
      const img = solid(8, 8, water);
      renderTrees(img, { seed0: 123456 });
      for (let i = 0; i < 8 * 8; i++) {
        expect(img.data[i * 4]).toBe(water[0]);
        expect(img.data[i * 4 + 1]).toBe(water[1]);
        expect(img.data[i * 4 + 2]).toBe(water[2]);
      }
    }
  });

  it("honors originX/originY and tilesPerPixel", () => {
    // Both windows must land somewhere with genuinely nonzero tree density, or
    // every assertion below degenerates: renderTrees is correctly a no-op at
    // density 0, so a zero-density window makes both the "renders differ" and
    // the "matches the exact blend" assertions pass trivially without
    // exercising the origin/tilesPerPixel coordinate mapping at all - which is
    // exactly the defect this test previously had (both of its original
    // windows sat in a tree-free clearing). These two windows are confirmed
    // nonzero for seed 123456: origin (420,-280) @ tilesPerPixel 2 and origin
    // (-2000,-2000) @ tilesPerPixel 1.
    const a = solid(4, 4, GRASS);
    const b = solid(4, 4, GRASS);
    renderTrees(a, { seed0: 123456, originX: 420, originY: -280, tilesPerPixel: 2 });
    renderTrees(b, { seed0: 123456, originX: -2000, originY: -2000, tilesPerPixel: 1 });
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));

    const density = makeTreeDensity({ seed0: 123456 });
    const worldX = 420 + 2 * 3;
    const worldY = -280 + 2 * 1;
    const d = density(worldX, worldY);
    // Non-vacuity guard: without this, the test would silently pass even if
    // the sampled window happened to fall in a forest gap (density 0), since
    // the "exact blend" assertion below collapses to the untouched grass
    // pixel at alpha 0 - proving nothing about the coordinate mapping it
    // exists to verify. This guard is the point of the exercise.
    expect(d).toBeGreaterThan(0);

    const alpha = TREE_MAX_ALPHA * d;
    const o = (1 * 4 + 3) * 4;
    expect(a.data[o]).toBe(Math.round(GRASS[0] * (1 - alpha) + TREE_MAP_COLOR[0] * alpha));
  });

  it("is a no-op where density is zero", () => {
    // A pixel whose density is 0 must be byte-identical afterwards.
    const img = solid(64, 64, GRASS);
    const before = Array.from(img.data);
    renderTrees(img, { seed0: 123456 });
    const density = makeTreeDensity({ seed0: 123456 });
    let checked = 0;
    for (let py = 0; py < 64; py++) {
      for (let px = 0; px < 64; px++) {
        if (density(px, py) !== 0) continue;
        checked++;
        const o = (py * 64 + px) * 4;
        for (let c = 0; c < 4; c++) expect(img.data[o + c]).toBe(before[o + c]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
