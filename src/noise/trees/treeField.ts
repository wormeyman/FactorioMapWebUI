import { asymmetricRamps } from "./asymmetricRamps";
import { clamp } from "../eval/math";
import { distanceFromNearestPoint, type Point } from "../distanceFromNearestPoint";
import { fastPow } from "../fastApprox";
import { makeMoisture } from "../expressions/moisture";
import { makeMultioctaveNoise } from "../multioctaveNoise";
import { makeNauvisShared } from "../expressions/nauvisShared";
import { makeTemperature } from "../expressions/temperature";
import { makeTreeShared } from "./treeShared";
import { TREE_SPECIES, type TreeSpecies } from "./treeCatalog";

/**
 * A conservative upper bound on `|basisNoise|`, used to bound each species' noise
 * term so the density max can skip evaluating octaves that cannot win.
 *
 * This is a MEASURED maximum plus a safety margin, not an analytic bound - the
 * basis range is not a clean +/-sqrt(3) (see docs/noise/basis-noise-NOTES.md).
 * treeFieldEarlyOut.spec.ts asserts both that the bound holds against hard
 * sampling AND that the early-out result is bit-identical to full evaluation, so
 * a wrong value fails loudly instead of silently clipping forests.
 */
export const BASIS_ABS_MAX = 1.8;

export interface TreeFieldParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:trees:frequency; default 1. */
  readonly treesFrequency?: number;
  /** control:trees:size; default 1. */
  readonly treesSize?: number;
  /** control:water:frequency; default 1. */
  readonly segmentationMultiplier?: number;
  /** Climate levers, forwarded to makeMoisture. */
  readonly moistureFrequency?: number;
  readonly moistureBias?: number;
  readonly startingAreaMoistureSize?: number;
  readonly startingAreaMoistureFrequency?: number;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export interface TreeSpeciesField {
  readonly species: TreeSpecies;
  readonly evalAt: (x: number, y: number) => number;
  /** The species value minus its own noise term - an upper bound on the sum. */
  readonly cheapAt: (x: number, y: number) => number;
  readonly noiseAt: (x: number, y: number) => number;
  /** The largest magnitude this species' noise term can reach. */
  readonly maxNoise: number;
}

/**
 * `|multioctave_noise|` cannot exceed `outputScale * norm * (sum of octave
 * amplitudes) * BASIS_ABS_MAX`. With octaves 3 and persistence 0.65 the octave
 * amplitudes are `norm * (1, 1/P, 1/P^2)`; `norm` is the RMS normalisation
 * multioctaveNoise applies. Mirrors multioctaveNoise.ts:70-99.
 */
function maxNoiseFor(species: TreeSpecies): number {
  const P = 0.65;
  const octaves = 3;
  const invP2 = 1 / (P * P);
  // fastPow, NOT `**` - multioctaveNoise normalises with the game's fastapprox
  // pow, and the bound must be computed the same way or it is not a bound.
  const norm = Math.sqrt((invP2 - 1) / (fastPow(invP2, octaves) - 1));
  let amps = 0;
  let amp = norm;
  for (let k = 0; k < octaves; k++) {
    amps += amp;
    amp /= P;
  }
  return species.outputScale * amps * BASIS_ABS_MAX;
}

/**
 * Compile all 15 Nauvis tree species probability expressions for one seed.
 *
 * `temperature` has been ported and oracle-validated since M2 but was never
 * evaluated by anything - tile selection turned out to be aux + moisture only.
 * This is its first consumer. There is no user-facing temperature control, so it
 * runs at the game's defaults (frequency 1, bias 0).
 */
export function makeTreeSpeciesFields(params: TreeFieldParams): TreeSpeciesField[] {
  const seed0 = params.seed0;
  const treesFrequency = params.treesFrequency ?? 1;
  const treesSize = params.treesSize ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];

  const nz = makeNauvisShared({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
  });
  const { smallNoise, forestPathCutoutFaded } = makeTreeShared(
    { seed0, segmentationMultiplier: params.segmentationMultiplier },
    nz,
  );
  const temperature = makeTemperature({ seed0 });
  const moisture = makeMoisture({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
    moistureFrequency: params.moistureFrequency,
    moistureBias: params.moistureBias,
    startingAreaMoistureSize: params.startingAreaMoistureSize,
    startingAreaMoistureFrequency: params.startingAreaMoistureFrequency,
    startingPositions: [...startingPositions],
  });

  return TREE_SPECIES.map((species) => {
    const noise = makeMultioctaveNoise({
      seed0,
      seed1: species.seed1,
      octaves: 3,
      persistence: 0.65,
      inputScale: (1 / species.inputScaleDiv) * treesFrequency,
      outputScale: species.outputScale,
    });

    // The size lever is a flat additive term, per-species (tree_05/tree_07 use
    // -0.45 where the other 13 species use -0.5 - see TreeSpecies.sizeOffset).
    // Hoisted here so it's computed once per species, not once per pixel.
    const sizeTerm = -species.sizeOffset + 0.2 * treesSize;

    /** Everything except this species' own noise term. Bounds `evalAt` from above. */
    const cheapAt = (x: number, y: number): number => {
      const distance = distanceFromNearestPoint(x, y, startingPositions);
      const climate = Math.min(
        0,
        asymmetricRamps(temperature(x, y), ...species.tempRamp),
        asymmetricRamps(moisture(x, y), ...species.moistRamp),
      );
      return climate + Math.min(0, distance / 20 - 3) + sizeTerm + smallNoise(x, y) * 0.1;
    };

    const evalAt = (x: number, y: number): number =>
      Math.min(species.cap, forestPathCutoutFaded(x, y), cheapAt(x, y) + noise(x, y));

    return { species, evalAt, cheapAt, noiseAt: noise, maxNoise: maxNoiseFor(species) };
  });
}

/**
 * The per-pixel tree density: `clamp(max_i p_i, 0, 1)`.
 *
 * `max` is not an approximation. Per docs/noise/placement-roll-NOTES.md, the game's
 * `EntityMapGenerationTask::generateEntities` arbitrates a single winning entity per
 * tile by MAX probability and then rolls once against it, so `max_i p_i` is exactly
 * the probability the game rolls on a tile where a tree wins. The density-shaded
 * render is therefore the expected value of what the game draws, and the eventual
 * placement-stipple project (Phase 2) consumes this identical field.
 */
export function makeTreeDensity(params: TreeFieldParams): (x: number, y: number) => number {
  const fields = makeTreeSpeciesFields(params);
  return (x: number, y: number): number => {
    let best = 0;
    for (const f of fields) {
      // `cap` and the cutout both bound the species from above, as does
      // `cheap + maxNoise`. If none can beat `best`, the 3-octave noise cannot
      // change the answer - skip it. Catalog order (descending cap) raises `best`
      // early, which maximises how often this fires.
      if (f.species.cap <= best) continue;
      const cheap = f.cheapAt(x, y);
      if (cheap + f.maxNoise <= best) continue;
      const v = f.evalAt(x, y);
      if (v > best) best = v;
    }
    return clamp(best, 0, 1);
  };
}
