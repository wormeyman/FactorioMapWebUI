import { makeMultioctaveNoise } from "../multioctaveNoise";
import { makeNauvisShared, type NauvisShared } from "../expressions/nauvisShared";
import { TREE_SMALL_NOISE_SEED1 } from "./treeCatalog";

export interface TreeSharedParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:water:frequency; default 1. Threads into the billow fields. */
  readonly segmentationMultiplier?: number;
}

export interface TreeShared {
  /** `tree_small_noise` - noise-programs.lua:427. */
  readonly smallNoise: (x: number, y: number) => number;
  /** `trees_forest_path_cutout` - noise-programs.lua:439. */
  readonly forestPathCutout: (x: number, y: number) => number;
  /** `trees_forest_path_cutout_faded` - noise-programs.lua:444. */
  readonly forestPathCutoutFaded: (x: number, y: number) => number;
}

/**
 * The tree-specific shared noise fields from core/prototypes/noise-programs.lua:
 *
 *   tree_small_noise               = multioctave_noise{persistence 0.75, octaves 3,
 *                                                      seed1 'tree-small',
 *                                                      input_scale 0.2, output_scale 0.5}
 *   forest_paths                   = (forest_path_billows   - 0.07) * 3
 *   nauvis_hills_paths             = (nauvis_hills          - 0.1)  * 3
 *   nauvis_bridge_paths            = (nauvis_bridge_billows - 0.07) * 5
 *   trees_forest_path_cutout       = min(nauvis_bridge_paths, nauvis_hills_paths, forest_paths)
 *   trees_forest_path_cutout_faded = trees_forest_path_cutout * 0.3 + tree_small_noise * 0.1
 *
 * These are what carve the forest paths (and, via moisture, the same cutouts the
 * climate tree already uses). `tree_small_noise`'s `input_scale` is flat 0.2 - it
 * is NOT scaled by `control:trees:frequency`, unlike each species' own noise term.
 *
 * Pass an existing {@link NauvisShared} to reuse its closures instead of rebuilding
 * the billow fields (the render path already has one).
 */
export function makeTreeShared(params: TreeSharedParams, shared?: NauvisShared): TreeShared {
  const seed0 = params.seed0;
  const nz =
    shared ?? makeNauvisShared({ seed0, segmentationMultiplier: params.segmentationMultiplier });

  const smallNoise = makeMultioctaveNoise({
    seed0,
    seed1: TREE_SMALL_NOISE_SEED1,
    octaves: 3,
    persistence: 0.75,
    inputScale: 0.2,
    outputScale: 0.5,
  });

  const forestPathCutout = (x: number, y: number): number =>
    Math.min(
      (nz.bridgeBillows(x, y) - 0.07) * 5,
      (nz.hills(x, y) - 0.1) * 3,
      (nz.forestPathBillows(x, y) - 0.07) * 3,
    );

  const forestPathCutoutFaded = (x: number, y: number): number =>
    forestPathCutout(x, y) * 0.3 + smallNoise(x, y) * 0.1;

  return { smallNoise, forestPathCutout, forestPathCutoutFaded };
}
