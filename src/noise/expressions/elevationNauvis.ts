import { basisNoiseTablesFromSeed } from "../basisNoise";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { basisNoiseExpr } from "../eval/primitives";
import { clamp, lerp, max, min } from "../eval/math";
import { withCtxDefaults, type EvalCtxInput } from "../eval/ctx";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import { makeQuickMultioctaveNoisePersistence } from "../quickMultioctaveNoise";
import { startingLakePositions as computeStartingLakes } from "../startingLakes";
import {
  amplitudeCorrectedMultioctaveNoise,
  makeVariablePersistenceMultioctaveNoise,
} from "../variablePersistenceMultioctaveNoise";
import type { BasisNoiseTables } from "../basisNoise";

export interface ElevationNauvisParams {
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
   * `startingLakePositions`. Pass `[]` for far-field-only behavior.
   */
  readonly startingLakePositions?: Point[];
}

/**
 * Compile the `elevation_nauvis` tree for one seed into a `(x, y) => elevation`
 * evaluator. Mirrors core/prototypes/noise-programs.lua 1:1
 * (`elevation_nauvis_function(nauvis_hills_plateaus)`); every basis table and
 * octave closure is derived once here. See the M1 nauvis design spec.
 */
export function makeElevationNauvis(
  params: ElevationNauvisParams,
): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const waterLevel = params.waterLevel ?? 0;
  const seg = params.segmentationMultiplier ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];
  const startingLakePositions =
    params.startingLakePositions ?? computeStartingLakes(seed0, startingPositions);

  // nauvis_segmentation_multiplier = 1.5 * control:water:frequency. EVERY noise
  // sub-node scales/offsets by THIS, not by the plain `seg` (= segmentation_multiplier);
  // only starting_island uses plain seg (see below). See noise-programs.lua.
  const nauvisSeg = 1.5 * seg;
  const offsetX = 10000 / nauvisSeg;

  // Hoisted noise closures / tables (persistence field still varies per tile).
  const bridgeBillows = makeMultioctaveNoise({
    seed0,
    seed1: 700,
    octaves: 4,
    persistence: 0.5,
    inputScale: nauvisSeg / 150,
    outputScale: 1,
  });
  const detail = makeVariablePersistenceMultioctaveNoise({
    seed0,
    seed1: 600,
    octaves: 5,
    inputScale: nauvisSeg / 14,
    outputScale: 0.03,
    offsetX,
  });
  const macroA = makeMultioctaveNoise({
    seed0,
    seed1: 1000,
    octaves: 2,
    persistence: 0.6,
    inputScale: nauvisSeg / 1600,
    outputScale: 1,
  });
  const macroB = makeMultioctaveNoise({
    seed0,
    seed1: 1100,
    octaves: 1,
    persistence: 0.6,
    inputScale: nauvisSeg / 1600,
    outputScale: 1,
  });
  const hills = makeMultioctaveNoise({
    seed0,
    seed1: 900,
    octaves: 4,
    persistence: 0.5,
    inputScale: nauvisSeg / 90,
    outputScale: 1,
  });
  const cliffLevelTables: BasisNoiseTables = basisNoiseTablesFromSeed(seed0, 99584);
  const persistanceTables: BasisNoiseTables = basisNoiseTablesFromSeed(seed0, 500);
  const startingLakeNoise = makeQuickMultioctaveNoisePersistence({
    seed0,
    seed1: 14,
    octaves: 4,
    inputScale: 1 / 8,
    outputScale: 0.8,
    octaveInputScaleMultiplier: 0.5,
    persistence: 0.68,
  });

  return (x: number, y: number): number => {
    // nauvis_persistance -> nauvis_detail (variable persistence field)
    const persistence = clamp(
      amplitudeCorrectedMultioctaveNoise(
        x,
        y,
        {
          seed0,
          seed1: 500,
          octaves: 5,
          inputScale: nauvisSeg / 2,
          offsetX,
          persistence: 0.7,
          amplitude: 0.5,
        },
        persistanceTables,
      ) + 0.55,
      0.5,
      0.65,
    );
    const nauvisDetail = detail(x, y, persistence);

    // nauvis_bridges
    const bb = Math.abs(bridgeBillows(x, y));
    const nauvisBridges = 1 - 0.1 * bb - 0.9 * max(0, -0.1 + bb);

    // nauvis_macro
    const nauvisMacro = macroA(x, y) * max(0, macroB(x, y));

    // nauvis_hills -> nauvis_plateaus -> nauvis_hills_plateaus (= added_cliff_elevation)
    const nauvisHills = Math.abs(hills(x, y));
    const cliffLevel = clamp(
      0.65 +
        basisNoiseExpr(
          x,
          y,
          { seed0, seed1: 99584, inputScale: nauvisSeg / 500, outputScale: 0.6 },
          cliffLevelTables,
        ),
      0.15,
      1.15,
    );
    const nauvisPlateaus = 0.5 + clamp((nauvisHills - cliffLevel) * 10, -0.5, 0.5);
    const addedCliffElevation = 0.1 * nauvisHills + 0.8 * nauvisPlateaus;

    // elevation_nauvis_function body (elevation_magnitude = 20, wlc_amplitude = 2)
    const distance = distanceFromNearestPoint(x, y, startingPositions);
    const startingMacroMultiplier = clamp((distance * nauvisSeg) / 2000, 0, 1);
    const nauvisMain =
      20 *
      (lerp(
        0.5 * addedCliffElevation - 0.6,
        1.9 * addedCliffElevation + 1.6,
        0.1 + 0.5 * nauvisBridges,
      ) +
        0.25 * nauvisDetail +
        3 * nauvisMacro * startingMacroMultiplier);
    const startingIsland = nauvisMain + 20 * (2.5 - (distance * seg) / 200);
    const wlcElevation = max(nauvisMain - waterLevel * 2, startingIsland);

    const sld = distanceFromNearestPoint(x, y, startingLakePositions, 1024);
    const sln = startingLakeNoise(x, y);
    const startingLake = (20 * (-3 + (sld + sln) / 8)) / 8;

    return min(wlcElevation, startingLake);
  };
}

/**
 * Evaluate `elevation_nauvis` at a single point. Convenience over
 * {@link makeElevationNauvis} - for sweeping a grid, call makeElevationNauvis once
 * and reuse the returned evaluator.
 */
export function elevationNauvis(ctx: EvalCtxInput): number {
  const c = withCtxDefaults(ctx);
  return makeElevationNauvis({
    seed0: c.seed0,
    waterLevel: c.waterLevel,
    segmentationMultiplier: c.segmentationMultiplier,
    startingPositions: c.startingPositions,
    startingLakePositions: c.startingLakePositions,
  })(c.x, c.y);
}
