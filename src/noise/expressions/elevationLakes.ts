import { basisNoiseTablesFromSeed } from "../basisNoise";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { basisNoiseExpr } from "../eval/primitives";
import { clamp, max, min } from "../eval/math";
import { withCtxDefaults, type EvalCtxInput } from "../eval/ctx";
import { makeQuickMultioctaveNoisePersistence } from "../quickMultioctaveNoise";
import { startingLakePositions as computeStartingLakes } from "../startingLakes";
import {
  amplitudeCorrectedMultioctaveNoise,
  makeVariablePersistenceMultioctaveNoise,
} from "../variablePersistenceMultioctaveNoise";

export interface ElevationLakesParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** 10*log2(control:water:size); default 0. */
  readonly waterLevel?: number;
  /** control:water:frequency; default 1. */
  readonly segmentationMultiplier?: number;
  /** Spawn points for `distance` (uncapped). Default single origin spawn. */
  readonly startingPositions?: Point[];
  /**
   * Lake points for `starting_lake_distance` (capped at 1024). When omitted, the
   * game's real positions are computed from `(seed0, startingPositions)` via
   * `startingLakePositions` (startingLakes.ts). Pass `[]` for the old far-field-only
   * behavior.
   */
  readonly startingLakePositions?: Point[];
  /**
   * make_0_12like_lakes `bias` (branch 1's additive term). Default 20 (elevation_lakes).
   * elevation_island passes -1000. Branch 2's literal 20 is independent of this.
   */
  readonly bias?: number;
}

/**
 * Compile the `elevation_lakes` tree for one seed into a `(x, y) => elevation`
 * evaluator. The two heavy variable-persistence octave stacks (8 and 6 octaves),
 * the basis-123 tables, the amplitude-corrected persistence field, and the
 * quick-persistence lake noise all derive their basis tables once here. Mirrors
 * core/prototypes/noise-programs.lua 1:1 - see the M1 design spec.
 */
export function makeElevationLakes(params: ElevationLakesParams): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const waterLevel = params.waterLevel ?? 0;
  const seg = params.segmentationMultiplier ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];
  const startingLakePositions =
    params.startingLakePositions ?? computeStartingLakes(seed0, startingPositions);

  // make_0_12like_lakes locals (bias = 20, terrain_octaves = 8).
  const bias = params.bias ?? 20;
  const terrainOctaves = 8;
  const inputScale = seg / 2;
  const offsetX = 10000 / seg;

  // Heavy octave stacks: build closures once (persistence still varies per tile).
  const varPers1 = makeVariablePersistenceMultioctaveNoise({
    seed0,
    seed1: 1,
    octaves: terrainOctaves,
    inputScale,
    outputScale: 0.125,
    offsetX,
  });
  const varPers2 = makeVariablePersistenceMultioctaveNoise({
    seed0,
    seed1: 2,
    octaves: 6,
    inputScale,
    outputScale: 0.125,
    offsetX,
  });

  // finish_elevation's basis term (seed1 = 123): derive tables once.
  const basisTables123 = basisNoiseTablesFromSeed(seed0, 123);

  // amplitude_corrected persistence field (seed1 = 1): derive tables once.
  const ampTables = basisNoiseTablesFromSeed(seed0, 1);

  // finish_elevation's starting_lake_noise (seed1 = 14): build the closure once.
  const quickLakeNoise = makeQuickMultioctaveNoisePersistence({
    seed0,
    seed1: 14,
    octaves: 5,
    inputScale: 1 / 8,
    outputScale: 1,
    octaveInputScaleMultiplier: 0.5,
    persistence: 0.75,
  });

  const make0_12likeLakes = (x: number, y: number): number => {
    // persistence field: clamp(amplitude_corrected + 0.3, 0.1, 0.9), fed to BOTH branches.
    const p = clamp(
      amplitudeCorrectedMultioctaveNoise(
        x,
        y,
        {
          seed0,
          seed1: 1,
          octaves: terrainOctaves - 2,
          inputScale,
          offsetX,
          persistence: 0.7,
          amplitude: 0.5,
        },
        ampTables,
      ) + 0.3,
      0.1,
      0.9,
    );
    const distance = distanceFromNearestPoint(x, y, startingPositions);
    const branch1 = bias + varPers1(x, y, p);
    // NOTE: literal 20, not `bias` (they coincide at elevation_lakes; elevation_island
    // sets bias = -1000 so branch 2 keeps 20 while branch 1 collapses).
    const branch2 = 20 + waterLevel - 0.1 * seg * distance + varPers2(x, y, p);
    return max(branch1, branch2);
  };

  const finishElevation = (elevation: number, x: number, y: number): number => {
    const sld = distanceFromNearestPoint(x, y, startingLakePositions, 1024);
    const sln = quickLakeNoise(x, y);
    const term1 = (elevation - waterLevel) / seg;
    const term2 =
      basisNoiseExpr(
        x,
        y,
        { seed0, seed1: 123, inputScale: 1 / 8, outputScale: 1.5 },
        basisTables123,
      ) +
      sld / 4 -
      4;
    const term3 = -1 + (sld + sln) / 16;
    const term4 = max(2, 2 + sld / 16 + sln / 2);
    return min(term1, term2, term3, term4);
  };

  return (x: number, y: number): number => finishElevation(make0_12likeLakes(x, y), x, y);
}

/**
 * Evaluate `elevation_lakes` at a single point. Convenience over
 * {@link makeElevationLakes} - for sweeping a grid, call makeElevationLakes once
 * and reuse the returned evaluator.
 */
export function elevationLakes(ctx: EvalCtxInput): number {
  const c = withCtxDefaults(ctx);
  return makeElevationLakes({
    seed0: c.seed0,
    waterLevel: c.waterLevel,
    segmentationMultiplier: c.segmentationMultiplier,
    startingPositions: c.startingPositions,
    startingLakePositions: c.startingLakePositions,
  })(c.x, c.y);
}
