/**
 * Factorio's `random_penalty` noise operation (`NoiseOperations::RandomPenalty`),
 * reverse-engineered from the non-stripped 2.1.11 binary
 * (`RandomPenalty.cpp` / `RandomPenalty::run`) and verified against the headless
 * oracle. See docs/noise/random-penalty-NOTES.md.
 *
 *   output[i] = source[i] - amplitude * (taus88_next() / 2^32)      // U in [0,1)
 *
 * Two facts make this a BATCH op, not a pure per-position function:
 *
 * 1. The RNG is seeded ONCE, from the FIRST position in the batch:
 *      word = max(341, 0x3FBE2C + 7919*trunc(x0) + 7907*trunc(y0 + seed))   (u32)
 *    (same RNG family as spot_noise: base 0x3FBE2C, primes 7919/7907, the 341
 *    clamp; no map_seed dependence; `seed` is folded into y before truncation.)
 *    taus88 state s1=s2=s3=word.
 * 2. The taus88 stream is then consumed across the batch, processed from the LAST
 *    element to the FIRST (the game's index counts down). A tile whose `source` is
 *    <= 0 is passed through unchanged and consumes NO draw (the documented
 *    "source must be > 0" guard).
 *
 * So the value at a given (x, y) depends on the whole batch and its order - which
 * is why a bare `calculate_tile_properties` probe cannot oracle this in isolation.
 * Callers must supply the batch in the same order the game evaluates it.
 */
import { seededState, taus88Next } from "./taus88";

/** 2^32, the normalization the binary applies (int32 draw * 2^-32 -> [0,1)). */
const TWO_POW_32 = 4294967296;
/** taus88 all-zero fixed-point guard, applied to the final word (unsigned). */
const WORD_FLOOR = 0x155; // 341

/** A batch position, in world tiles (fractional allowed; truncated toward zero). */
export interface RandomPenaltyPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * The per-region/per-batch seed word: `max(341, 0x3FBE2C + 7919*trunc(x0) +
 * 7907*trunc(y0 + seed))` in unsigned 32-bit arithmetic, from the first batch
 * position's coordinates. Exposed for tests and for callers that reproduce the
 * stream directly.
 */
export function randomPenaltyWord(x0: number, y0: number, seed: number): number {
  const xi = Math.trunc(x0) | 0;
  const yi = Math.trunc(y0 + seed) | 0;
  const w = (0x3fbe2c + Math.imul(xi, 7919) + Math.imul(yi, 7907)) >>> 0;
  return (w > WORD_FLOOR ? w : WORD_FLOOR) >>> 0;
}

/**
 * Evaluate `random_penalty{source, amplitude, seed}` over an ordered batch,
 * reproducing `RandomPenalty::run` bit-for-bit. `source[i]` is the (already
 * evaluated) source value at `positions[i]`; the result aligns with `positions`.
 *
 * The RNG is seeded from `positions[0]` and streamed from the last element to the
 * first; a `source[i] <= 0` element passes through unchanged and consumes no draw.
 */
export function randomPenaltyBatch(
  positions: readonly RandomPenaltyPosition[],
  source: readonly number[],
  params: { seed: number; amplitude: number },
): number[] {
  const { seed, amplitude } = params;
  const out: number[] = Array.from({ length: positions.length }, () => 0);
  if (positions.length === 0) return out;

  const st = seededState(randomPenaltyWord(positions[0].x, positions[0].y, seed));
  // Processed last element -> first, matching the binary's descending index.
  for (let i = positions.length - 1; i >= 0; i--) {
    const s = source[i];
    if (s > 0) {
      const u = taus88Next(st) / TWO_POW_32;
      out[i] = s - amplitude * u;
    } else {
      out[i] = s;
    }
  }
  return out;
}
