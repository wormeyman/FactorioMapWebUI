/**
 * A reimplementation of Factorio's `basis_noise` primitive.
 *
 * Reverse-engineered against Factorio 2.1.11 and verified to a max error of
 * 3.1e-7 - tighter than the game's own internal self-consistency (~2e-6, from
 * its fastapprox `pow`). See docs/noise/basis-noise-NOTES.md for the derivation
 * and the evidence.
 *
 * The `(seed0, seed1) -> tables` derivation is also solved:
 * `basisNoiseTablesFromSeed` builds `a`/`b`/`sigma` straight from the seed (no
 * game round-trip), matching the disassembly of `Noise::setSeed` and verified
 * against the game across the seed combine, the low-byte salt and the clamp.
 *
 * NOT wired into the app. This is the building block a client-side map preview
 * would need; the editor itself does not evaluate noise.
 */
import { seededState, taus88Next } from "./taus88";

/** Number of gradient directions, and the period of the hash on each axis. */
const TABLE_SIZE = 256;

/** Measured at 4.19999919 +/- 1.4e-6 across 9216 lattice points. */
const GRADIENT_MAGNITUDE = 4.2;

const GRADIENT_X: readonly number[] = Array.from({ length: TABLE_SIZE }, (_, h) =>
  Math.cos((2 * Math.PI * h) / TABLE_SIZE),
);
const GRADIENT_Y: readonly number[] = Array.from({ length: TABLE_SIZE }, (_, h) =>
  Math.sin((2 * Math.PI * h) / TABLE_SIZE),
);

/**
 * The per-seed tables. `a` and `b` are the per-axis permutation tables of
 * Kensler's "Better Gradient Noise" hash (`h = a[i] ^ b[j]`); `sigma` maps that
 * hash to a gradient direction index.
 *
 * Build them from a seed with `basisNoiseTablesFromSeed`, or hand-supply a
 * gauge-equivalent set (the three tables are only determined up to a gauge, so
 * they need not be the game's literal internals; they reproduce its output
 * exactly, which is what matters here).
 */
export interface BasisNoiseTables {
  /** Hash value -> gradient direction index. Permutation of 0..255. */
  readonly sigma: readonly number[];
  /** X-axis permutation table. */
  readonly a: readonly number[];
  /** Y-axis permutation table. */
  readonly b: readonly number[];
}

/**
 * Evaluate `basis_noise` at a point in *noise space* - callers apply
 * `input_scale` themselves (noise coords = world coords * input_scale), exactly
 * as the game's `basis_noise{input_scale = ...}` parameter does.
 *
 * Returns 0 at integer lattice points, which is the game's documented quirk and
 * falls out of the kernel rather than being special-cased.
 */
export function basisNoise(x: number, y: number, tables: BasisNoiseTables): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  let value = 0;
  // Summation over the 4 cell corners, simplex-style, rather than Perlin's
  // separable interpolation: the (1-d)^3 falloff reaches exactly 0 at d = 1, so
  // corners further than one unit contribute nothing.
  for (let cornerY = 0; cornerY <= 1; cornerY++) {
    for (let cornerX = 0; cornerX <= 1; cornerX++) {
      const dx = fx - cornerX;
      const dy = fy - cornerY;
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;

      const hash =
        tables.a[(ix + cornerX) & (TABLE_SIZE - 1)] ^ tables.b[(iy + cornerY) & (TABLE_SIZE - 1)];
      const g = tables.sigma[hash & (TABLE_SIZE - 1)];
      const falloff = (1 - d) ** 3;
      value += falloff * GRADIENT_MAGNITUDE * (dx * GRADIENT_X[g] + dy * GRADIENT_Y[g]);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Seed -> tables. Straight from the disassembly of Factorio 2.1.11's
// `Noise::setSeed(uint, uchar)` and `Noise::noise` (arm64 slice). The three
// tables and the salt are built by shuffling identity permutations with one
// continuous taus88 stream seeded from the map seed; see the notes.
// ---------------------------------------------------------------------------

/**
 * All-zero state is a taus88 fixed point, so the seed word is clamped from below
 * to 0x155 (the same clamp `spot_noise` uses). This is why every seed in
 * `0..341` produces the same field, and why `seed0`'s bit 0 is dead (the taus88
 * state words drop their low bits on the first step).
 */
const MIN_SEED_WORD = 0x155;

/**
 * A backward (Durstenfeld) Fisher-Yates shuffle of `identity[0..255]`, drawing
 * 255 values from the stream: for `pos` from 255 down to 1, swap slot `pos` with
 * `next() % (pos + 1)`. This is exactly the shuffle the game applies to each of
 * its four tables, all off one continuous stream.
 */
function shuffleIdentity(next: () => number): number[] {
  const t = Array.from({ length: TABLE_SIZE }, (_, i) => i);
  for (let pos = TABLE_SIZE - 1; pos >= 1; pos--) {
    const j = next() % (pos + 1);
    const tmp = t[pos];
    t[pos] = t[j];
    t[j] = tmp;
  }
  return t;
}

/**
 * Build the `basis_noise` tables directly from `(seed0, seed1)` - `seed0` is the
 * map seed, `seed1` distinguishes the many `basis_noise` calls a map-gen program
 * makes. Reproduces the game to the ~2e-7 noise floor.
 *
 * The wiring (from `Noise::setSeed`): the effective taus88 seed word is
 * `max(seed0 + 7*(seed1>>8), 0x155)` - `seed1`'s low byte is *not* in the word -
 * and the three state words are all set to it. One continuous stream then drives
 * four identity shuffles in order: a scratch table (from which the byte
 * `scratch[seed1 & 0xff]` is taken as a salt), the Y-axis table, the X-axis
 * table, and the gradient permutation. Evaluation hashes as
 * `gradPerm[xTable[i] ^ yTable[j] ^ salt]`; folding the salt into `sigma` lets the
 * plain `a[i] ^ b[j]` evaluator above reproduce it unchanged.
 */
export function basisNoiseTablesFromSeed(seed0: number, seed1: number): BasisNoiseTables {
  const word = Math.max((seed0 + 7 * (seed1 >>> 8)) >>> 0, MIN_SEED_WORD);
  const saltIndex = seed1 & (TABLE_SIZE - 1);
  const st = seededState(word);
  const next = () => taus88Next(st);

  const scratch = shuffleIdentity(next);
  const salt = scratch[saltIndex];
  const yTable = shuffleIdentity(next);
  const xTable = shuffleIdentity(next);
  const gradPerm = shuffleIdentity(next);

  const sigma = Array.from(
    { length: TABLE_SIZE },
    (_, h) => gradPerm[(h ^ salt) & (TABLE_SIZE - 1)],
  );
  return { a: xTable, b: yTable, sigma };
}
