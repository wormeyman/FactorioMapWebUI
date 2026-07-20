import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { clamp, lerp, max, min, sliderToLinear } from "../eval/math";
import { makeNauvisShared } from "./nauvisShared";
import { makeQuickMultioctaveNoise } from "../quickMultioctaveNoise";

export interface MoistureParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:water:frequency; default 1. Threads into nauvis_plateaus/hills/etc via makeNauvisShared. */
  readonly segmentationMultiplier?: number;
  /** control:moisture:frequency; default 1. */
  readonly moistureFrequency?: number;
  /** control:moisture:bias; default 0. */
  readonly moistureBias?: number;
  /** control:starting_area_moisture:size (starting-area bias lever); default 1 (degenerate - see below). */
  readonly startingAreaMoistureSize?: number;
  /** control:starting_area_moisture:frequency (starting-area falloff lever); default 1. */
  readonly startingAreaMoistureFrequency?: number;
  /** Spawn points for the starting-area bias region distance (uncapped). Default single origin spawn. */
  readonly startingPositions?: Point[];
}

/**
 * Compile the `moisture` (= `moisture_nauvis`) climate tree for one seed into an
 * `(x, y) => moisture` evaluator. Mirrors core/prototypes/noise-programs.lua 1:1 -
 * the most complex climate expression: a base 4-octave `quick_multioctave_noise`
 * term, a starting-area bias blend keyed on `distance_from_nearest_point` (uncapped,
 * unlike the elevation tree's capped `starting_lake_distance`), and a forest-path /
 * hills / bridge-billows "cutout" that pulls moisture down near cliffs and forest
 * paths so they don't get swallowed by high-moisture biomes.
 *
 * `nauvis_plateaus`, `nauvis_hills`, `nauvis_bridge_billows`, `forest_path_billows`
 * are the shared Nauvis sub-tree (also used by `elevation_nauvis` and `aux_nauvis`) -
 * see {@link makeNauvisShared}.
 *
 * At the default `startingAreaMoistureSize = 1`, `sliderToLinear(1, -0.5, 0.5) = 0`,
 * so `startingBiasChange = 0` and the starting-area bias blend collapses to
 * `moistureAdjustedBias = baseBias` everywhere (the starting-area levers have no
 * effect at their defaults) - a degenerate but real path, still validated end to
 * end by the oracle fixture at defaults.
 */
export function makeMoisture(params: MoistureParams): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const segmentationMultiplier = params.segmentationMultiplier ?? 1;
  const moistureFrequency = params.moistureFrequency ?? 1;
  const moistureBias = params.moistureBias ?? 0;
  const startingAreaMoistureSize = params.startingAreaMoistureSize ?? 1;
  const startingAreaMoistureFrequency = params.startingAreaMoistureFrequency ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];

  const nz = makeNauvisShared({ seed0, segmentationMultiplier });

  const moistureNoise = makeQuickMultioctaveNoise({
    seed0,
    seed1: 6,
    octaves: 4,
    inputScale: moistureFrequency / 256,
    outputScale: 0.125,
    offsetX: 30000 / moistureFrequency,
    octaveOutputScaleMultiplier: 1.5,
    octaveInputScaleMultiplier: 1 / 3,
  });

  const baseBias = moistureBias;
  const startingBiasChange = sliderToLinear(startingAreaMoistureSize, -0.5, 0.5);
  const startingBias = lerp(baseBias, startingBiasChange, Math.abs(2 * startingBiasChange) * 1.1);

  return (x: number, y: number): number => {
    const distance = distanceFromNearestPoint(x, y, startingPositions);
    const startingBiasRegion = clamp(2 - (startingAreaMoistureFrequency / 400) * distance, 0, 1);
    const moistureAdjustedBias = lerp(baseBias, startingBias, startingBiasRegion);

    const moistureMain = clamp(
      0.4 + moistureAdjustedBias + moistureNoise(x, y) - 0.08 * (nz.plateaus(x, y) - 0.6),
      0,
      1,
    );

    const treesForestPathCutout = min(
      (nz.bridgeBillows(x, y) - 0.07) * 5,
      (nz.hills(x, y) - 0.1) * 3,
      (nz.forestPathBillows(x, y) - 0.07) * 3,
    );

    return max(
      min(moistureMain, 0.45),
      moistureMain - 0.2 * max(0, 1 - treesForestPathCutout * 1.5),
    );
  };
}
