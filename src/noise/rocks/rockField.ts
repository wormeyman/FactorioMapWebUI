/**
 * The Nauvis rocks placement-probability field: `clamp(max_i probability_i, 0, 1)`
 * over the three charted rock prototypes (huge-rock, big-rock, big-sand-rock).
 * Per-tile arbitration is max probability (docs/noise/placement-roll-NOTES.md), so
 * the max is exact - it is the probability the game rolls where a rock wins, i.e.
 * the expected value the overlay shades and the session-2 dither will quantize.
 *
 * probability = multiplier * control:rocks:size * (region_box + rock_density - penalty)
 * See rockCatalog.ts / the plan header for the per-prototype constants.
 */
import { clamp } from "../eval/math";
import { sliderRescale } from "../eval/sliderRescale";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { makeAux } from "../expressions/aux";
import { makeMoisture } from "../expressions/moisture";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import { rangeSelectBase, ROCK_SEED1 } from "./rockCatalog";

export interface RockFieldParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:rocks:frequency; default 1. */
  readonly rocksFrequency?: number;
  /** control:rocks:size; default 1. */
  readonly rocksSize?: number;
  /** control:water:frequency; default 1. Threads into moisture/aux shared noise. */
  readonly segmentationMultiplier?: number;
  readonly moistureFrequency?: number;
  readonly moistureBias?: number;
  readonly auxFrequency?: number;
  readonly auxBias?: number;
  readonly startingAreaMoistureSize?: number;
  readonly startingAreaMoistureFrequency?: number;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export function makeRockDensity(params: RockFieldParams): (x: number, y: number) => number {
  const seed0 = params.seed0;
  const freq = params.rocksFrequency ?? 1;
  const size = params.rocksSize ?? 1;
  const spawn: readonly Point[] = params.startingPositions ?? [{ x: 0, y: 0 }];

  const noise = makeMultioctaveNoise({
    seed0,
    seed1: ROCK_SEED1,
    octaves: 4,
    persistence: 0.9,
    inputScale: 0.15 * freq,
    outputScale: 1,
  });
  const moisture = makeMoisture({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
    moistureFrequency: params.moistureFrequency,
    moistureBias: params.moistureBias,
    startingAreaMoistureSize: params.startingAreaMoistureSize,
    startingAreaMoistureFrequency: params.startingAreaMoistureFrequency,
    startingPositions: [...spawn],
  });
  const aux = makeAux({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
    frequency: params.auxFrequency,
    bias: params.auxBias,
  });

  // control:rocks:size enters twice: as the outer multiplier and inside rock_noise
  // via slider_rescale. sizeTerm is the size-dependent, position-independent tail
  // of rock_noise, hoisted out of the per-pixel loop.
  const sizeTerm = 0.25 + 0.75 * (sliderRescale(size, 1.5) - 1);

  return (x: number, y: number): number => {
    const rockNoise = noise(x, y) + sizeTerm;
    const distance = distanceFromNearestPoint(x, y, spawn);
    const rockDensity = rockNoise - Math.max(0, 1.1 - distance / 32);

    const m = moisture(x, y);
    const moistBand = rangeSelectBase(m, 0.35, 1, 0.2, -10, 0);
    const pHuge = 0.07 * size * (moistBand + rockDensity - 1.7);
    const pBig = 0.17 * size * (moistBand + rockDensity - 1.6);

    const a = aux(x, y);
    const sandBand = Math.min(
      rangeSelectBase(a, 0.3, 1, 0.3, -10, 0),
      rangeSelectBase(m, 0, 0.3, 0.2, -10, 0),
    );
    const pSand = 0.1 * size * (sandBand + rockDensity - 1.6);

    return clamp(Math.max(pHuge, pBig, pSand), 0, 1);
  };
}
