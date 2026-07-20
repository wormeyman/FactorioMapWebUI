/**
 * Tile-autoplace helper functions: the small building blocks the 21-tile
 * catalog (Task 9) composes into each tile's probability expression. Each one
 * is pure composition over already-validated primitives - {@link expressionInRange}
 * (Task 1, RE'd against the headless oracle) and {@link makeMultioctaveNoise} - so
 * no new oracle capture is needed here.
 */

import { makeMultioctaveNoise } from "../multioctaveNoise";
import { expressionInRange } from "./expressionInRange";

/**
 * The game's `expression_in_range_base(aux_from, moisture_from, aux_to, moisture_to)`,
 * a curried helper that fixes `peak_multiplier = 20` and `peak_maximum = 1` and
 * regroups the two climate axes (aux, moisture) into `expression_in_range`'s
 * flat `expr/from/to` argument lists:
 *
 *   expression_in_range_base(aux_from, moisture_from, aux_to, moisture_to)
 *     = expression_in_range(20, 1, aux, moisture, aux_from, moisture_from, aux_to, moisture_to)
 *
 * Used throughout the tile catalog to make a tile probable only inside an
 * (aux, moisture) climate box, with a hard AND across both axes (via
 * `expressionInRange`'s min-of-edge-distances) and a plateau capped at 1.
 */
export function expressionInRangeBase(
  aux: number,
  moisture: number,
  auxFrom: number,
  moistureFrom: number,
  auxTo: number,
  moistureTo: number,
): number {
  return expressionInRange(20, 1, [aux, moisture], [auxFrom, moistureFrom], [auxTo, moistureTo]);
}

/**
 * The game's `water_base(max_elevation, influence)`:
 *
 *   water_base(max_elevation, influence) =
 *     if(max_elevation >= elevation, influence * min(max_elevation - elevation, 1), -inf)
 *
 * `elevation` is the runtime per-tile value, so it is the first parameter here;
 * `maxElevation`/`influence` are the tile's constants. Below `maxElevation` the
 * result ramps up linearly over the last 1 unit of headroom to a plateau of
 * `influence`; at or above `maxElevation` the tile is excluded entirely
 * (`-Infinity`, never selected by the resolver's argmax).
 */
export function waterBase(elevation: number, maxElevation: number, influence: number): number {
  return maxElevation >= elevation ? influence * Math.min(maxElevation - elevation, 1) : -Infinity;
}

/**
 * The game's `noise_layer_noise(seed)`:
 *
 *   noise_layer_noise(seed) = multioctave_noise{
 *     persistence = 0.7, seed1 = seed, octaves = 4,
 *     input_scale = 1/6, output_scale = 2/3,
 *   }
 *
 * `seed0` is the map seed; `seed1` is the per-layer seed selector (the game's
 * `seed` argument). Returns a closure `(x, y) => number` built once per
 * (seed0, seed1) pair - the common case for rendering a grid at one seed.
 */
export function makeNoiseLayerNoise(
  seed0: number,
  seed1: number,
): (x: number, y: number) => number {
  return makeMultioctaveNoise({
    seed0,
    seed1,
    octaves: 4,
    persistence: 0.7,
    inputScale: 1 / 6,
    outputScale: 2 / 3,
  });
}
