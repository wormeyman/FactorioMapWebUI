/**
 * A reimplementation of Factorio's `basis_noise` primitive.
 *
 * Reverse-engineered against Factorio 2.1.11 and verified to a max error of
 * 3.1e-7 - tighter than the game's own internal self-consistency (~2e-6, from
 * its fastapprox `pow`). See docs/noise/basis-noise-NOTES.md for the derivation,
 * the evidence, and the one piece still missing (the seed -> tables derivation).
 *
 * NOT wired into the app. This is the building block a client-side map preview
 * would need; the editor itself does not evaluate noise.
 */

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
 * These are recovered from the game per seed - deriving them from `seed0` /
 * `seed1` directly is still an open problem. The three tables are only
 * determined up to a gauge, so they need not be the game's literal internals;
 * they reproduce its output exactly, which is what matters here.
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
