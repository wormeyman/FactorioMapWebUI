import { makeElevationLakes, type ElevationLakesParams } from "./elevationLakes";
import { withCtxDefaults, type EvalCtxInput } from "../eval/ctx";

/** Same free variables as elevation_lakes; `bias` is fixed at -1000 internally. */
export type ElevationIslandParams = Omit<ElevationLakesParams, "bias">;

/**
 * Compile the `elevation_island` tree for one seed into a `(x, y) => elevation`
 * evaluator. Island is `elevation_lakes` with `bias = -1000` and
 * `segmentation_multiplier / 4` (the game's `segmentation_mult`), fed to both
 * make_0_12like_lakes and finish_elevation. Callers pass the RAW user
 * segmentation; the /4 is applied here. See noise-programs.lua `elevation_island`.
 */
export function makeElevationIsland(
  params: ElevationIslandParams,
): (x: number, y: number) => number {
  const seg = params.segmentationMultiplier ?? 1;
  return makeElevationLakes({
    ...params,
    bias: -1000,
    segmentationMultiplier: seg / 4,
  });
}

/**
 * Evaluate `elevation_island` at a single point. Convenience over
 * {@link makeElevationIsland} - for sweeping a grid, call makeElevationIsland once
 * and reuse the returned evaluator.
 */
export function elevationIsland(ctx: EvalCtxInput): number {
  const c = withCtxDefaults(ctx);
  return makeElevationIsland({
    seed0: c.seed0,
    waterLevel: c.waterLevel,
    segmentationMultiplier: c.segmentationMultiplier,
    startingPositions: c.startingPositions,
    startingLakePositions: c.startingLakePositions,
  })(c.x, c.y);
}
