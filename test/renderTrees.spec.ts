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

// Independent re-implementation of the footprint model, so these expectations
// are derived from the spec (drawRectangle rasterizes a 1.0-tile box floor to
// ceil, blending every touched pixel at full alpha; a uniform sub-tile offset
// gives the separable [0.5, 1, 0.5] kernel; neighbouring placements are
// independent events so coverage = 1 - product of misses), never by echoing
// whatever renderTrees.ts happens to compute.
const KERNEL = [0.5, 1.0, 0.5];

/**
 * Coverage at world coordinate (wx, wy), where the 3x3 neighbourhood is spaced
 * by `tpp` world tiles - matching how the pixel grid maps to world coordinates
 * at a given tilesPerPixel.
 */
function coverageAt(
  density: (x: number, y: number) => number,
  wx: number,
  wy: number,
  tpp = 1,
): number {
  let miss = 1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const p = density(wx + dx * tpp, wy + dy * tpp) * KERNEL[dx + 1] * KERNEL[dy + 1];
      miss *= 1 - p;
    }
  }
  return 1 - miss;
}

/** The game's integer blend: 255->256 alpha fixup, then `((256-a)*dst + a*src) >> 8`. */
function blendChannel(dst: number, src: number, coverage: number): number {
  const A = Math.round(TREE_MAX_ALPHA * coverage * 255);
  const a = A + (A >> 7);
  return ((256 - a) * dst + a * src) >> 8;
}

describe("renderTrees", () => {
  it("uses the game's own tree chart color and alpha", () => {
    // core/prototypes/utility-constants.lua:201 -
    //   default_color_by_type["tree"] = {0.19, 0.39, 0.19, 0.40}
    expect(TREE_MAP_COLOR).toEqual([48, 99, 48]);
    expect(TREE_MAX_ALPHA).toBeCloseTo(0.4, 12);
  });

  it("blends toward the tree color in proportion to the footprint coverage", () => {
    const img = solid(16, 16, GRASS);
    renderTrees(img, { seed0: 123456, originX: 0, originY: 0, tilesPerPixel: 1 });
    const density = makeTreeDensity({ seed0: 123456 });
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        const o = (py * 16 + px) * 4;
        const coverage = coverageAt(density, px, py);
        for (let c = 0; c < 3; c++) {
          const expected = blendChannel(GRASS[c], TREE_MAP_COLOR[c], coverage);
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
    // zero coverage, so a zero-density window makes both the "renders differ" and
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
    // pixel at coverage 0 - proving nothing about the coordinate mapping it
    // exists to verify. This guard is the point of the exercise.
    expect(d).toBeGreaterThan(0);

    // The kernel neighbours here are 2 world tiles apart (tilesPerPixel 2), not 1.
    const coverage = coverageAt(density, worldX, worldY, 2);
    const o = (1 * 4 + 3) * 4;
    expect(a.data[o]).toBe(blendChannel(GRASS[0], TREE_MAP_COLOR[0], coverage));
  });

  it("is a no-op where coverage is zero", () => {
    // A pixel whose 3x3 neighbourhood is all zero density must be byte-identical
    // afterwards (coverage collapses to exactly 0, no blend applied at all).
    const img = solid(64, 64, GRASS);
    const before = Array.from(img.data);
    renderTrees(img, { seed0: 123456 });
    const density = makeTreeDensity({ seed0: 123456 });
    let checked = 0;
    for (let py = 0; py < 64; py++) {
      for (let px = 0; px < 64; px++) {
        if (coverageAt(density, px, py) !== 0) continue;
        checked++;
        const o = (py * 64 + px) * 4;
        for (let c = 0; c < 4; c++) expect(img.data[o + c]).toBe(before[o + c]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
