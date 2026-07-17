/**
 * A reimplementation of Factorio's `quick_multioctave_noise` primitive
 * (`NoiseExpressions::QuickMultioctaveNoise`), reverse-engineered against Factorio
 * 2.1.11 - by disassembling `QuickMultioctaveNoise::run` and fitting the committed
 * oracle. See docs/noise/quick-multioctave-noise-NOTES.md. Built on {@link basisNoise}.
 *
 * The shape:
 *
 *   quick(x, y) = SUM_{k=0}^{N-1}  OS*OOSM^k *
 *                 basis( (x + offset_x) * IS*OISM^k ,  y * IS*OISM^k ;
 *                        tables(octaveSeed0(seed0, seed1, k), seed1) )
 *
 * i.e. N octaves of `basis_noise`, each with input scale multiplied by
 * `octave_input_scale_multiplier` (OISM) and output contribution multiplied by
 * `octave_output_scale_multiplier` (OOSM). Unlike the plain `multioctave_noise`
 * op there is NO RMS normalisation (it is the "raw" building block; the
 * `quick_multioctave_noise_persistence` Lua wrapper pre-scales `input_scale` and
 * `output_scale` to compensate) and NO per-octave x offset in noise space - octaves
 * are decorrelated by re-seeding instead: the basis seed word steps by +2 every pair
 * of octaves (so octaves 0,1 share a seed word, 2,3 the next, ...); see
 * {@link octaveSeed0} for the exact per-octave seed and its low-bit subtlety.
 * `offset_x` is a single world-space x translation applied to every octave
 * (`(x + offset_x)` before scaling), NOT the k*17.17/offset_x per-octave shift the
 * plain / variable-persistence ops use.
 *
 * The temperature / moisture / aux climate trees use this op (each passes
 * `offset_x = <big> / var('control:<name>:frequency')`).
 *
 * Verified against the game to the basis floor (~3e-7) for small coordinates,
 * loosening to ~7e-4 where a large `offset_x` pushes the noise-space coordinate to
 * thousands of tiles (the documented f32 floor; see basis-noise-NOTES.md). NOT
 * wired into the app - a building block for a client-side map preview.
 */

import { basisNoise, basisNoiseTablesFromSeed, type BasisNoiseTables } from "./basisNoise";

export interface QuickMultioctaveParams {
  /** Map seed (basis seed word). */
  readonly seed0: number;
  /** Per-call seed selector (distinguishes the many multioctave calls a program makes). */
  readonly seed1: number;
  /** Octave count (>= 1). */
  readonly octaves: number;
  /** Base input scale (noise units per world tile) for octave 0. */
  readonly inputScale: number;
  /** Overall output multiplier applied to octave 0. */
  readonly outputScale: number;
  /** Amplitude ratio between successive octaves (`octave_output_scale_multiplier`). */
  readonly octaveOutputScaleMultiplier: number;
  /** Input-scale ratio between successive octaves (`octave_input_scale_multiplier`). */
  readonly octaveInputScaleMultiplier: number;
  /** World-space x translation applied to every octave (`(x + offsetX)` before scaling). */
  readonly offsetX: number;
}

/**
 * The `seed0` to feed {@link basisNoiseTablesFromSeed} for octave `k`. Octaves pair
 * up: 0 and 1 share a seed word, 2 and 3 the next, etc. - the disassembly shows a
 * per-octave `seed += const` accumulator, and the oracle pins the cadence to +2 per
 * pair of octaves.
 *
 * The subtlety is a low-bit interaction. Factorio's basis seed *word* is
 * `seed0 + 7*(seed1>>8)` (see {@link basisNoiseTablesFromSeed}); the per-octave +2
 * lands on that combined word, and its parity - `phase = (7*(seed1>>8)) & 1` - shifts
 * which octave in each pair the +2 falls on. Written in terms of the `seed0` we pass
 * (so the game's `+ 7*(seed1>>8)` re-adds inside the derivation):
 *
 *   seed0_k = seed0 - phase + 2*floor((k + phase) / 2)
 *
 * For the common case `seed1 < 256` (all base-game quick usages: seed1 = 5,6,7,123),
 * `phase = 0` and this reduces to `seed0 + 2*floor(k/2)`. Verified against the game
 * for phase 0 and 1 across seven seed1 values. `>>> 0` keeps it an unsigned 32-bit
 * word.
 */
function octaveSeed0(seed0: number, seed1: number, k: number): number {
  const phase = (7 * (seed1 >>> 8)) & 1;
  return (seed0 - phase + 2 * Math.floor((k + phase) / 2)) >>> 0;
}

/**
 * Evaluate `quick_multioctave_noise` at world coordinates `(x, y)`. Because each
 * octave uses a distinct seed word (every second octave), a per-call `tables` cache
 * would only help within an octave pair; the derivation is cheap, so this recomputes
 * per octave. Sweeping many points at one seed still benefits from caching the tables
 * by octave - see {@link makeQuickMultioctaveNoise}.
 */
export function quickMultioctaveNoise(
  x: number,
  y: number,
  params: QuickMultioctaveParams,
): number {
  const { seed0, seed1, octaves, inputScale, outputScale } = params;
  const oism = params.octaveInputScaleMultiplier;
  const oosm = params.octaveOutputScaleMultiplier;
  const offsetX = params.offsetX;

  let sum = 0;
  let scale = inputScale;
  let amp = outputScale;
  let prevSeed0 = NaN;
  let tables: BasisNoiseTables | null = null;
  for (let k = 0; k < octaves; k++) {
    const s0 = octaveSeed0(seed0, seed1, k);
    if (s0 !== prevSeed0) {
      tables = basisNoiseTablesFromSeed(s0, seed1);
      prevSeed0 = s0;
    }
    sum += amp * basisNoise((x + offsetX) * scale, y * scale, tables as BasisNoiseTables);
    scale *= oism;
    amp *= oosm;
  }
  return sum;
}

/**
 * Build a closure that evaluates `quick_multioctave_noise` for a fixed parameter set,
 * with the per-octave basis tables derived once up front (the common case for
 * rendering a grid at one seed). Returns `(x, y) => number`.
 */
export function makeQuickMultioctaveNoise(
  params: QuickMultioctaveParams,
): (x: number, y: number) => number {
  const { seed0, seed1, octaves, inputScale, outputScale } = params;
  const oism = params.octaveInputScaleMultiplier;
  const oosm = params.octaveOutputScaleMultiplier;
  const offsetX = params.offsetX;

  const octaveTables: BasisNoiseTables[] = [];
  const octaveScale: number[] = [];
  const octaveAmp: number[] = [];
  let scale = inputScale;
  let amp = outputScale;
  for (let k = 0; k < octaves; k++) {
    octaveTables.push(basisNoiseTablesFromSeed(octaveSeed0(seed0, seed1, k), seed1));
    octaveScale.push(scale);
    octaveAmp.push(amp);
    scale *= oism;
    amp *= oosm;
  }

  return (x: number, y: number): number => {
    let sum = 0;
    for (let k = 0; k < octaves; k++) {
      const s = octaveScale[k];
      sum += octaveAmp[k] * basisNoise((x + offsetX) * s, y * s, octaveTables[k]);
    }
    return sum;
  };
}

export interface QuickMultioctavePersistenceParams {
  /** Map seed (basis seed word). */
  readonly seed0: number;
  /** Per-call seed selector. */
  readonly seed1: number;
  /** Octave count (>= 1). */
  readonly octaves: number;
  /** Base input scale (noise units per world tile). */
  readonly inputScale: number;
  /** Overall output multiplier. */
  readonly outputScale: number;
  /** Input-scale ratio between successive octaves. */
  readonly octaveInputScaleMultiplier: number;
  /** Amplitude ratio between successive octaves. */
  readonly persistence: number;
}

/**
 * `quick_multioctave_noise_persistence` - the Lua wrapper
 * (`core/prototypes/noise-functions.lua`) over {@link quickMultioctaveNoise}. It
 * normalises the raw quick op by pre-scaling `input_scale` and `output_scale`, and
 * maps `persistence` to the octave output multiplier:
 *
 *   input_scale  = input_scale * octave_input_scale_multiplier^(octaves - 1)
 *   output_scale = output_scale * 2^(octaves - 1)
 *   octave_output_scale_multiplier = persistence
 *   octave_input_scale_multiplier  = 1 / octave_input_scale_multiplier
 *
 * so the finest octave lands at `input_scale` and the sum is `2^(N-1)`-scaled. The
 * elevation tree's `starting_lake_noise` uses this. `offset_x` defaults to 0.
 */
export function quickMultioctaveNoisePersistence(
  x: number,
  y: number,
  params: QuickMultioctavePersistenceParams,
): number {
  const { octaves, octaveInputScaleMultiplier: oism } = params;
  return quickMultioctaveNoise(x, y, {
    seed0: params.seed0,
    seed1: params.seed1,
    octaves,
    inputScale: params.inputScale * oism ** (octaves - 1),
    outputScale: params.outputScale * 2 ** (octaves - 1),
    octaveOutputScaleMultiplier: params.persistence,
    octaveInputScaleMultiplier: 1 / oism,
    offsetX: 0,
  });
}
