/**
 * A reimplementation of Factorio's `variable_persistence_multioctave_noise`
 * primitive (`NoiseOperations::VariablePersistenceMultioctaveNoise`),
 * reverse-engineered against Factorio 2.1.11 - by disassembling its register
 * `run` (`NoiseOperations::VariablePersistenceMultioctaveNoise::run` @0x10174a318)
 * and fitting the committed oracle. See
 * docs/noise/variable-persistence-multioctave-noise-NOTES.md. Built on
 * {@link basisNoise}.
 *
 * This is the op the **elevation** tree uses (nauvis `make_0_12like_lakes`). Its
 * defining feature: `persistence` is a spatially-varying value (a noise
 * *expression* the game evaluates per tile), so successive octaves are attenuated
 * by a persistence that changes across the map. Here the caller supplies that
 * per-tile `persistence` scalar.
 *
 * The shape:
 *
 *   varPers(x, y) = output_scale * 2^N * SUM_{k=0}^{N-1} p^(N-1-k) *
 *                   basis( (x + offset_x)*S_k + k*OCTAVE_SHIFT , y*S_k ;
 *                          tables(seed0, seed1) )
 *
 *     S_k = input_scale * 0.5^(k+1)      (finest octave scale = input_scale/2)
 *     p   = persistence at this tile
 *     N   = octaves
 *
 * i.e. N octaves of `basis_noise` sharing ONE (seed0, seed1) - each octave halves
 * the input scale (lacunarity 1/2) and is weighted by a power of the per-tile
 * persistence, combined in Horner order (finest octave gets the smallest weight
 * p^(N-1), coarsest gets 1). Three things distinguish it from the relatives:
 *
 * 1. **No RMS normalisation.** It is the raw weighted sum times a `2^N` gain. The
 *    `amplitude_corrected_multioctave_noise` Lua wrapper is what normalises, by
 *    passing `output_scale = (1 - p)/2^N/(1 - p^N) * amplitude`. (The RMS-norm
 *    branch in the `Noise::multioctaveNoise(...,float const*,...)` float overload
 *    is a *different* entry point; the register `run` path the game evaluates via
 *    `calculate_tile_properties` has none.)
 * 2. **`offset_x` is a single world-space x translation** `(x + offset_x)*scale`,
 *    applied identically to every octave - like `quick_multioctave_noise`, NOT the
 *    plain op's per-octave `k*17.17/offset_x` noise-space shift.
 * 3. **Octaves decorrelate by a fixed per-octave x shift** `k*OCTAVE_SHIFT` in noise
 *    space (the game's "'x' variables are shifted to avoid 'fractal similarity'"),
 *    NOT by re-seeding - the seed is shared across octaves.
 *
 * Verified against the game to the basis floor (~1e-7) for small coordinates,
 * loosening where a large `offset_x` / far world point pushes the noise-space
 * coordinate to thousands of tiles (the documented f32 floor; see
 * basis-noise-NOTES.md). NOT wired into the app - a building block for a
 * client-side map preview.
 */

import { basisNoise, basisNoiseTablesFromSeed, type BasisNoiseTables } from "./basisNoise";

/**
 * Fixed per-octave x shift in noise space, added as `k*OCTAVE_SHIFT` for octave k.
 * Measured constant (=-0x1F00), independent of seed, input_scale, offset_x and
 * persistence to the noise floor. It is what decorrelates the same-seed octaves.
 * (A narrow offset scan finds false minima near -4864 / -3840; the true value only
 * holds up under a wide, input-scale-independent fit - see the notes.)
 */
const OCTAVE_SHIFT = -7936;

export interface VariablePersistenceMultioctaveParams {
  /** Map seed (basis seed word). */
  readonly seed0: number;
  /** Per-call seed selector (distinguishes the many multioctave calls a program makes). */
  readonly seed1: number;
  /** Octave count (>= 1). */
  readonly octaves: number;
  /** Base input scale (noise units per world tile); octave 0 uses `input_scale/2`. */
  readonly inputScale: number;
  /** Overall output multiplier (the op additionally applies a `2^octaves` gain). */
  readonly outputScale: number;
  /** World-space x translation applied to every octave (`(x + offsetX)` before scaling). */
  readonly offsetX: number;
}

/**
 * Evaluate `variable_persistence_multioctave_noise` at world coordinates `(x, y)`
 * with a per-tile `persistence`. Pass a prebuilt `tables` to skip the seed
 * derivation when sweeping many points at one seed (the common case for rendering);
 * the seed is shared across octaves, so a single tables object serves them all.
 *
 * The octaves are combined in Horner order exactly as the game's `run` does (add
 * the octave, then multiply the running accumulator by the tile's persistence -
 * except after the last octave), so octave k carries weight `p^(N-1-k)`.
 */
export function variablePersistenceMultioctaveNoise(
  x: number,
  y: number,
  persistence: number,
  params: VariablePersistenceMultioctaveParams,
  tables: BasisNoiseTables = basisNoiseTablesFromSeed(params.seed0, params.seed1),
): number {
  const { octaves, inputScale, outputScale, offsetX } = params;

  let acc = 0;
  let scale = inputScale * 0.5; // octave 0 = input_scale / 2
  for (let k = 0; k < octaves; k++) {
    acc += basisNoise((x + offsetX) * scale + k * OCTAVE_SHIFT, y * scale, tables);
    if (k < octaves - 1) acc *= persistence;
    scale *= 0.5;
  }
  return outputScale * 2 ** octaves * acc;
}

/**
 * Build a closure that evaluates `variable_persistence_multioctave_noise` for a
 * fixed parameter set, with the per-octave scales (and the shared basis tables)
 * derived once up front (the common case for rendering a grid at one seed). The
 * returned function takes `(x, y, persistence)` - persistence still varies per tile.
 */
export function makeVariablePersistenceMultioctaveNoise(
  params: VariablePersistenceMultioctaveParams,
): (x: number, y: number, persistence: number) => number {
  const { seed0, seed1, octaves, inputScale, outputScale, offsetX } = params;
  const tables = basisNoiseTablesFromSeed(seed0, seed1);
  const gain = outputScale * 2 ** octaves;

  const octaveScale: number[] = [];
  let scale = inputScale * 0.5;
  for (let k = 0; k < octaves; k++) {
    octaveScale.push(scale);
    scale *= 0.5;
  }

  return (x: number, y: number, persistence: number): number => {
    let acc = 0;
    for (let k = 0; k < octaves; k++) {
      const s = octaveScale[k];
      acc += basisNoise((x + offsetX) * s + k * OCTAVE_SHIFT, y * s, tables);
      if (k < octaves - 1) acc *= persistence;
    }
    return gain * acc;
  };
}
