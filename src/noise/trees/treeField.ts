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

/**
 * Every species' own noise term uses these. Shared with {@link maxNoiseFor} so the
 * early-out bound cannot silently desync from the noise it is meant to bound.
 */
const TREE_OCTAVES = 3;
const TREE_PERSISTENCE = 0.65;

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
  /**
   * `control:temperature:frequency` / `:bias`. The app has no UI for these, but
   * `climateReads` parses them out of an imported exchange string's
   * property_expression_names, and trees are the only consumer of `temperature`
   * - so dropping them here silently renders the wrong forest layout.
   */
  readonly temperatureFrequency?: number;
  readonly temperatureBias?: number;
  readonly startingAreaMoistureSize?: number;
  readonly startingAreaMoistureFrequency?: number;
  /** Spawn points for `distance`. Default single origin spawn. */
  readonly startingPositions?: readonly Point[];
}

export interface TreeSpeciesField {
  readonly species: TreeSpecies;
  readonly evalAt: (x: number, y: number) => number;
  /**
   * The species value minus its own noise term. Adding {@link maxNoise} to it
   * bounds {@link evalAt} from above; on its own it is simply that sum without
   * the noise, so it sits *below* `evalAt` wherever the noise is positive.
   */
  readonly cheapAt: (x: number, y: number) => number;
  /**
   * {@link cheapAt} with the per-pixel terms supplied by the caller, so a loop
   * over all 15 species evaluates the shared climate stack once instead of once
   * each. Positional rather than an object to keep the hot path allocation-free;
   * `makeTreeDensity` is the intended caller.
   */
  readonly cheapFrom: (
    temperature: number,
    moisture: number,
    distanceTerm: number,
    smallTerm: number,
  ) => number;
  readonly noiseAt: (x: number, y: number) => number;
  /** The largest magnitude this species' noise term can reach. */
  readonly maxNoise: number;
}

/**
 * The species-independent half of a tree evaluation, plus the fields needed to
 * compute it. `makeTreeDensity` evaluates these once per pixel; every species
 * then reuses the results.
 */
interface TreeFields {
  readonly fields: TreeSpeciesField[];
  readonly temperature: (x: number, y: number) => number;
  readonly moisture: (x: number, y: number) => number;
  readonly smallNoise: (x: number, y: number) => number;
  readonly forestPathCutout: (x: number, y: number) => number;
  readonly startingPositions: readonly Point[];
}

/**
 * `|multioctave_noise|` cannot exceed `outputScale * norm * (sum of octave
 * amplitudes) * BASIS_ABS_MAX`. With octaves 3 and persistence 0.65 the octave
 * amplitudes are `norm * (1, 1/P, 1/P^2)`; `norm` is the RMS normalisation
 * multioctaveNoise applies. Mirrors multioctaveNoise.ts:70-99.
 */
function maxNoiseFor(species: TreeSpecies): number {
  const P = TREE_PERSISTENCE;
  const octaves = TREE_OCTAVES;
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
 * This is its first consumer, which is why `control:temperature:*` only started
 * mattering here: the app has no UI for it, but an imported exchange string can
 * carry one, so the levers are threaded through rather than defaulted.
 */
export function makeTreeSpeciesFields(params: TreeFieldParams): TreeSpeciesField[] {
  return makeTreeFields(params).fields;
}

/** {@link makeTreeSpeciesFields}, also handing back the shared per-pixel fields. */
function makeTreeFields(params: TreeFieldParams): TreeFields {
  const seed0 = params.seed0;
  const treesFrequency = params.treesFrequency ?? 1;
  const treesSize = params.treesSize ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];

  const nz = makeNauvisShared({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
  });
  const { smallNoise, forestPathCutout, forestPathCutoutFaded } = makeTreeShared(
    { seed0, segmentationMultiplier: params.segmentationMultiplier },
    nz,
  );
  const temperature = makeTemperature({
    seed0,
    frequency: params.temperatureFrequency,
    bias: params.temperatureBias,
  });
  const moisture = makeMoisture({
    seed0,
    segmentationMultiplier: params.segmentationMultiplier,
    moistureFrequency: params.moistureFrequency,
    moistureBias: params.moistureBias,
    startingAreaMoistureSize: params.startingAreaMoistureSize,
    startingAreaMoistureFrequency: params.startingAreaMoistureFrequency,
    startingPositions: [...startingPositions],
  });

  const fields = TREE_SPECIES.map((species): TreeSpeciesField => {
    const noise = makeMultioctaveNoise({
      seed0,
      seed1: species.seed1,
      octaves: TREE_OCTAVES,
      persistence: TREE_PERSISTENCE,
      inputScale: (1 / species.inputScaleDiv) * treesFrequency,
      outputScale: species.outputScale,
    });

    // The size lever is a flat additive term, per-species (tree_05/tree_07 use
    // -0.45 where the other 13 species use -0.5 - see TreeSpecies.sizeOffset).
    // Hoisted here so it's computed once per species, not once per pixel.
    const sizeTerm = -species.sizeOffset + 0.2 * treesSize;

    // The term ORDER here is load-bearing: `treeFieldEarlyOut.spec.ts` asserts
    // makeTreeDensity is bit-identical to full evaluation, and float addition is
    // not associative. Keep the four addends in this sequence.
    const cheapFrom = (t: number, m: number, distanceTerm: number, smallTerm: number): number => {
      const climate = Math.min(
        0,
        asymmetricRamps(t, ...species.tempRamp),
        asymmetricRamps(m, ...species.moistRamp),
      );
      return climate + distanceTerm + sizeTerm + smallTerm;
    };

    const cheapAt = (x: number, y: number): number =>
      cheapFrom(
        temperature(x, y),
        moisture(x, y),
        Math.min(0, distanceFromNearestPoint(x, y, startingPositions) / 20 - 3),
        smallNoise(x, y) * 0.1,
      );

    const evalAt = (x: number, y: number): number =>
      Math.min(species.cap, forestPathCutoutFaded(x, y), cheapAt(x, y) + noise(x, y));

    return { species, evalAt, cheapAt, cheapFrom, noiseAt: noise, maxNoise: maxNoiseFor(species) };
  });

  return { fields, temperature, moisture, smallNoise, forestPathCutout, startingPositions };
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
  const { fields, temperature, moisture, smallNoise, forestPathCutout, startingPositions } =
    makeTreeFields(params);

  return (x: number, y: number): number => {
    // The species-independent terms, evaluated ONCE per pixel. The climate stack
    // (a 4-octave temperature and moisture's quick-multioctave plus billow cutout)
    // costs more than the 3-octave species noise the early-out saves, so computing
    // it per species - as this did originally - dominated the whole render.
    const t = temperature(x, y);
    const m = moisture(x, y);
    const distanceTerm = Math.min(0, distanceFromNearestPoint(x, y, startingPositions) / 20 - 3);
    const smallTerm = smallNoise(x, y) * 0.1;

    // `trees_forest_path_cutout_faded`, inlined so it reuses smallTerm rather than
    // re-evaluating tree_small_noise, and deferred until a species actually needs
    // it (pixels where every species is skipped never pay for the billows).
    let cutoutFaded = 0;
    let haveCutout = false;

    let best = 0;
    for (const f of fields) {
      // `cap` and the cutout both bound the species from above, as does
      // `cheap + maxNoise`. If none can beat `best`, the 3-octave noise cannot
      // change the answer - skip it. Catalog order (descending cap) raises `best`
      // early, which maximises how often this fires.
      if (f.species.cap <= best) continue;
      const cheap = f.cheapFrom(t, m, distanceTerm, smallTerm);
      if (cheap + f.maxNoise <= best) continue;
      if (!haveCutout) {
        cutoutFaded = forestPathCutout(x, y) * 0.3 + smallTerm;
        haveCutout = true;
      }
      const v = Math.min(f.species.cap, cutoutFaded, cheap + f.noiseAt(x, y));
      if (v > best) best = v;
    }
    return clamp(best, 0, 1);
  };
}
