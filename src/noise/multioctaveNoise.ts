/**
 * A reimplementation of Factorio's `multioctave_noise` primitive (the plain
 * `NoiseOperations::MultioctaveNoise`), reverse-engineered against Factorio 2.1.11
 * - partly by disassembling `Noise::multioctaveNoise`, partly by fitting the
 * oracle. See docs/noise/multioctave-noise-NOTES.md. Built on top of
 * {@link basisNoise}.
 *
 * The shape:
 *
 *   multioctave(x, y) = output_scale * norm * SUM_{k=0}^{N-1} (1/P)^k *
 *                       basis( x*IS*(1/2)^k + k*OCTAVE_OFFSET_X , y*IS*(1/2)^k )
 *
 * i.e. N octaves of `basis_noise` sharing ONE (seed0, seed1): each octave halves
 * the input scale (lacunarity 1/2), scales amplitude by 1/persistence, and shifts
 * x by a fixed per-octave offset (this is what decorrelates same-seed octaves -
 * the comment "'x' variables are shifted to avoid 'fractal similarity'" in the
 * game's noise programs). The whole sum is RMS-normalised by `norm` so its
 * variance is ~1 regardless of octave count / persistence.
 *
 * Verified against the game to ~1e-5 across octaves 1..6, persistence 0.45..0.9,
 * varied input/output scales and seeds. The residual is the game's own fastapprox
 * floor: the normalisation uses Factorio's approximate `log2`/`exp2` (Paul
 * Mineiro fastapprox), replicated here as {@link fastLog2} / {@link fastPow2}; with
 * a real `pow` the error would be ~1e-4 for non-power-of-two persistence.
 *
 * NOT wired into the app. Building block for a client-side map preview.
 */

import { basisNoise, basisNoiseTablesFromSeed, type BasisNoiseTables } from "./basisNoise";

/** Each octave halves the input scale (doubles the wavelength). */
const LACUNARITY = 0.5;

/**
 * Per-octave x shift in noise space, added as `k * OCTAVE_OFFSET_X` for octave k.
 * Measured constant for the plain primitive (input-scale-, seed- and
 * persistence-independent to the noise floor). The `quick`/`variable_persistence`
 * variants derive this from their `offset_x` parameter instead - not yet mapped.
 */
const OCTAVE_OFFSET_X = -1774.83;

// ---------------------------------------------------------------------------
// fastapprox log2 / exp2 - Paul Mineiro's approximations, exactly as Factorio's
// Math::log2 / Math::exp2f (read out of the 2.1.11 disassembly). Used for the
// normalisation's (1/P^2)^N power; matching them is what closes the last ~1e-4.
// ---------------------------------------------------------------------------

const f32 = Math.fround;
const i32 = new Int32Array(1);
const f32view = new Float32Array(i32.buffer);
const bitsToFloat = (bits: number): number => {
  i32[0] = bits;
  return f32view[0];
};
const floatToBits = (x: number): number => {
  f32view[0] = x;
  return i32[0];
};

/** Paul Mineiro `fastlog2`, matching Factorio's `Math::log2`. */
export function fastLog2(x: number): number {
  const bits = floatToBits(x) >>> 0;
  const y = f32(bits * 1.1920928955078125e-7); // bits * 2^-23
  const mx = bitsToFloat((bits & 0x007fffff) | 0x3f000000);
  return f32(y - 124.22551499 - 1.498030302 * mx - 1.72587999 / (0.3520887068 + mx));
}

/** Paul Mineiro `fastpow2`, matching Factorio's `Math::exp2f`. */
export function fastPow2(p: number): number {
  const clipp = p < -126 ? -126 : p;
  const w = Math.trunc(clipp); // (int)clipp, toward zero
  const z = f32(clipp - w + (clipp < 0 ? 1 : 0)); // fractional part, floor semantics
  const v = f32(
    (1 << 23) * f32(clipp + 121.2740575 + 27.7280233 / f32(4.84252568 - z) - 1.49012907 * z),
  );
  return bitsToFloat(v | 0);
}

/** `x^p` via the fastapprox pair, as the game computes the normalisation power. */
function fastPow(x: number, p: number): number {
  return fastPow2(f32(p * fastLog2(x)));
}

// ---------------------------------------------------------------------------

export interface MultioctaveParams {
  /** Map seed. */
  readonly seed0: number;
  /** Per-call seed selector (distinguishes the many multioctave calls a program makes). */
  readonly seed1: number;
  /** Octave count (>= 1). */
  readonly octaves: number;
  /** Amplitude ratio between successive octaves' contributions (0 < P < 1 typical). */
  readonly persistence: number;
  /** Base input scale (noise units per world tile) for the finest octave. */
  readonly inputScale: number;
  /** Overall output multiplier. */
  readonly outputScale: number;
}

/**
 * The RMS normalisation factor `sqrt( ((1/P)^2 - 1) / ((1/P)^(2N) - 1) )`, with the
 * `(1/P^2)^N` term via the game's fastapprox `pow`. The game evaluates this branch
 * for EVERY octave count (including N = 1, where it is ~1 but carries the fastapprox
 * wobble - so the shortcut `return 1` would be measurably wrong). For P = 1 the
 * ratio is 0/0 and the game instead uses `1/sqrt(N)`.
 */
function normalization(persistence: number, octaves: number): number {
  if (persistence === 1) return 1 / Math.sqrt(octaves);
  const invP2 = 1 / (persistence * persistence);
  return Math.sqrt((invP2 - 1) / (fastPow(invP2, octaves) - 1));
}

/**
 * Evaluate `multioctave_noise` at world coordinates `(x, y)`. Pass a prebuilt
 * `tables` to skip the per-call seed derivation when sweeping many points at one
 * seed (the common case for rendering).
 */
export function multioctaveNoise(
  x: number,
  y: number,
  params: MultioctaveParams,
  tables: BasisNoiseTables = basisNoiseTablesFromSeed(params.seed0, params.seed1),
): number {
  const { octaves, persistence, inputScale, outputScale } = params;
  const invP = 1 / persistence;
  const norm = normalization(persistence, octaves);

  let sum = 0;
  let scale = inputScale;
  let amp = norm;
  for (let k = 0; k < octaves; k++) {
    sum += amp * basisNoise(x * scale + k * OCTAVE_OFFSET_X, y * scale, tables);
    scale *= LACUNARITY;
    amp *= invP;
  }
  return outputScale * sum;
}
