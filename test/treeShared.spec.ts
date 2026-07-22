import { describe, expect, it } from "vite-plus/test";
import { makeNauvisShared } from "../src/noise/expressions/nauvisShared";
import { makeMultioctaveNoise } from "../src/noise/multioctaveNoise";
import { TREE_SMALL_NOISE_SEED1 } from "../src/noise/trees/treeCatalog";
import { makeTreeShared } from "../src/noise/trees/treeShared";

const GRID: Array<[number, number]> = [
  [0.5, 0.25],
  [220.5, -180.25],
  [-1600.5, 1200.25],
  [12345.75, 6789.125],
];

describe("makeTreeShared", () => {
  it("builds tree_small_noise as a flat-input-scale 3-octave multioctave", () => {
    // noise-programs.lua:427 - persistence 0.75, octaves 3, input_scale 0.2,
    // output_scale 0.5. input_scale is FLAT: unlike each species' own noise term,
    // tree_small_noise is NOT scaled by control:trees:frequency.
    const expected = makeMultioctaveNoise({
      seed0: 123456,
      seed1: TREE_SMALL_NOISE_SEED1,
      octaves: 3,
      persistence: 0.75,
      inputScale: 0.2,
      outputScale: 0.5,
    });
    const { smallNoise } = makeTreeShared({ seed0: 123456 });
    for (const [x, y] of GRID) expect(smallNoise(x, y)).toBe(expected(x, y));
  });

  it("composes the cutout as the min of the three path fields", () => {
    // trees_forest_path_cutout = min(nauvis_bridge_paths, nauvis_hills_paths, forest_paths)
    //   forest_paths        = (forest_path_billows  - 0.07) * 3
    //   nauvis_hills_paths  = (nauvis_hills         - 0.1)  * 3
    //   nauvis_bridge_paths = (nauvis_bridge_billows - 0.07) * 5
    const nz = makeNauvisShared({ seed0: 123456 });
    const { forestPathCutout } = makeTreeShared({ seed0: 123456 }, nz);
    for (const [x, y] of GRID) {
      const expected = Math.min(
        (nz.bridgeBillows(x, y) - 0.07) * 5,
        (nz.hills(x, y) - 0.1) * 3,
        (nz.forestPathBillows(x, y) - 0.07) * 3,
      );
      expect(forestPathCutout(x, y)).toBeCloseTo(expected, 12);
    }
  });

  it("fades the cutout with a tenth of the small noise", () => {
    // trees_forest_path_cutout_faded = cutout * 0.3 + tree_small_noise * 0.1
    const { smallNoise, forestPathCutout, forestPathCutoutFaded } = makeTreeShared({
      seed0: 123456,
    });
    for (const [x, y] of GRID) {
      expect(forestPathCutoutFaded(x, y)).toBeCloseTo(
        forestPathCutout(x, y) * 0.3 + smallNoise(x, y) * 0.1,
        12,
      );
    }
  });

  it("threads segmentationMultiplier into the billow fields", () => {
    const a = makeTreeShared({ seed0: 123456, segmentationMultiplier: 1 });
    const b = makeTreeShared({ seed0: 123456, segmentationMultiplier: 2 });
    const differs = GRID.some(([x, y]) => a.forestPathCutout(x, y) !== b.forestPathCutout(x, y));
    expect(differs).toBe(true);
  });

  it("leaves tree_small_noise independent of segmentationMultiplier", () => {
    const a = makeTreeShared({ seed0: 123456, segmentationMultiplier: 1 });
    const b = makeTreeShared({ seed0: 123456, segmentationMultiplier: 2 });
    for (const [x, y] of GRID) expect(a.smallNoise(x, y)).toBe(b.smallNoise(x, y));
  });
});
