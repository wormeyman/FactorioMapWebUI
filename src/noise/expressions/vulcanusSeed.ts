/**
 * Two of the four engine "seed vars" that drive Vulcanus's biome rotation
 * (`vulcanus_ashlands_angle = map_seed_normalized * 3600`,
 * `vulcanus_starting_direction = -1 + 2*(map_seed_small & 1)` -
 * `~/GitHub/factorio-data` `space-age/prototypes/planet/planet-vulcanus-map-gen.lua`).
 * Both are pure functions of `seed0` (= `map_seed`, the wire seed), documented
 * (not merely RE'd) in the game's own noise-expressions reference as "16 least
 * significant bits from map_seed" and "0-1 normalized value of map_seed"
 * respectively, and confirmed bit-exact against 12 oracle-sampled seeds
 * spanning the 32-bit range - see docs/noise/vulcanus-seed-vars-NOTES.md for
 * the derivation, residuals, and the `x_from_start`/`y_from_start` finding
 * (out of scope for this file: they resolved to `== x, y` at the default
 * spawn and needed no port).
 */

/**
 * `map_seed_normalized`: `Math.fround(seed0 / 2^32)`. The f32 rounding (the
 * noise VM's arithmetic) matters at the top of the range - `seedNormalized(
 * 0xFFFFFFFF)` is exactly `1`, not `0.99999999767...` as plain double division
 * gives; verified against the oracle, not assumed. Because of that, the
 * honest range is the CLOSED `[0, 1]`, not the half-open `[0, 1)` a "normalize
 * a 32-bit uint" description would suggest - see the NOTES file.
 */
export function seedNormalized(seed0: number): number {
  return Math.fround(seed0 / 4294967296);
}

/**
 * `map_seed_small`: the 16 least significant bits of `seed0`. Implemented
 * with `&`, whose `ToInt32` coercion is bit-identical to `seed0 % 65536` for
 * every `seed0` in `[0, 2^32)` (verified for all 12 oracle fixture rows,
 * including the two above `2^31`). Only this value's parity
 * (`seedSmall(seed0) & 1`) is consumed downstream
 * (`vulcanus_starting_direction`).
 */
export function seedSmall(seed0: number): number {
  return seed0 & 0xffff;
}
