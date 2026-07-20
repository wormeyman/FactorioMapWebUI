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
 * are decorrelated by re-seeding instead: each octave gets its own distinct basis
 * seed word, a flat `seed0 + k`; see {@link octaveSeed0} for the exact derivation
 * and the low-bit subtlety that once masked this.
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
 * The `seed0` to feed {@link basisNoiseTablesFromSeed} for octave `k`: a simple
 * per-octave `+1` on top of the map seed, `seed0 + k` (`>>> 0` keeps it an
 * unsigned 32-bit word). `seed1` is not part of this derivation - it is only
 * `basisNoiseTablesFromSeed`'s own `+ 7*(seed1>>8)` term (applied once there)
 * that folds `seed1` into the final basis word.
 *
 * An earlier version of this function derived a `phase = (7*(seed1>>8)) & 1`
 * and a "+2 every pair of octaves" cadence instead of a flat `+1`. That was a
 * mistaken over-fit: `taus88`'s `s1` update masks its input with
 * `0xfffffffe` (clears the low bit) before the first left-shift, so for an
 * EVEN starting word `W`, `basisNoiseTablesFromSeed(W, seed1)` and
 * `basisNoiseTablesFromSeed(W + 1, seed1)` happen to produce byte-identical
 * tables - which makes "+2 per pair" and "+1 per octave" numerically
 * indistinguishable whenever the pair's base word is even. Every prior oracle
 * capture used `seed0 = 123456` (even), so the coincidence was never exposed.
 * Task 10's tile-resolver parity test (3 seeds, one of them ODD - 654321)
 * caught it: per-octave isolation against the live game (quick_multioctave_noise
 * sampled at octaves=1..4 and differenced) showed octave 0 and 2 matching the
 * old formula but octaves 1 and 3 diverging by ~0.02-0.05 - exactly the two
 * octaves the old formula reused an even-derived word for, when the true word
 * for an ODD seed0 is one higher (odd) and does NOT collide. The flat `+1`
 * reproduces the live game to the basis floor for both parities, and remains
 * bit-identical to the old formula's output at seed 123456 (validated against
 * the full `oracle-quick-multioctave` fixture, including its one phase>=1
 * case, seed1=999).
 */
function octaveSeed0(seed0: number, _seed1: number, k: number): number {
  return (seed0 + k) >>> 0;
}

/**
 * Evaluate `quick_multioctave_noise` at world coordinates `(x, y)`. Every octave now
 * gets its own distinct seed word (flat `seed0 + k`), so the `s0 !== prevSeed0`
 * cache below is effectively dead - consecutive octaves never share a word, and the
 * branch is always taken. It is left in place (cheap, harmless, and a safety net if
 * the derivation ever changes back to something that repeats a word) rather than
 * removed. The derivation itself is cheap either way. Sweeping many points at one
 * seed still benefits from caching the tables by octave - see
 * {@link makeQuickMultioctaveNoise}.
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
  return makeQuickMultioctaveNoisePersistence(params)(x, y);
}

/**
 * Build a closure that evaluates `quick_multioctave_noise_persistence` for a fixed
 * parameter set, with the per-octave basis tables derived once up front (the common
 * case for rendering a grid at one seed). Applies the same param transform as
 * {@link quickMultioctaveNoisePersistence} but delegates to
 * {@link makeQuickMultioctaveNoise} so the tables are hoisted. Returns `(x, y) => number`.
 */
export function makeQuickMultioctaveNoisePersistence(
  params: QuickMultioctavePersistenceParams,
): (x: number, y: number) => number {
  const { octaves, octaveInputScaleMultiplier: oism } = params;
  return makeQuickMultioctaveNoise({
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
