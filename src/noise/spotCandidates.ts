/**
 * Factorio's `spot_noise` candidate-point RNG, reverse-engineered.
 *
 * The generator the community called "black magic" is the canonical L'Ecuyer
 * taus88, seeded per region from (seed0, seed1, region index) with three small
 * primes. Verified bit-exact against Factorio 2.1.11: it reproduces every
 * candidate point in blind tests across seeds, regions and region sizes
 * (including the game's real region_size = 1024). See
 * docs/noise/spot-noise-NOTES.md for the derivation and evidence.
 *
 * This covers candidate *generation* only. Spot selection (favorability sort,
 * regional quantity targets, minimum spacing rejection) sits on top of this
 * stream and is not reimplemented here.
 *
 * NOT wired into the app - like basisNoise.ts, it is a building block for a
 * client-side map preview.
 */

const M32 = 0x100000000;

/** W = (SEED_BASE + 7927*seed1 + 7919*rx + 7907*ry) mod 2^32, then ^ seed0. */
const SEED_BASE = 0x3fbe2c;
const SEED1_PRIME = 7927;
const RX_PRIME = 7919;
const RY_PRIME = 7907;

/**
 * All-zero state is a taus88 fixed point, so the game clamps the seed word from
 * below to 0x155 (measured: words 0..341 all behave as 341, 342 is untouched).
 * The clamp applies to the final word, after the seed0 XOR.
 */
const MIN_SEED_WORD = 0x155;

export interface SpotRegionKey {
  seed0: number;
  seed1: number;
  /** Region index. Regions are *centred* on multiples of region_size. */
  regionX: number;
  regionY: number;
}

interface Taus88State {
  s1: number;
  s2: number;
  s3: number;
}

/** One canonical taus88 step (output taken after the update). */
function taus88Next(st: Taus88State): number {
  st.s1 = ((((st.s1 & 0xfffffffe) << 12) >>> 0) ^ ((((st.s1 << 13) >>> 0) ^ st.s1) >>> 19)) >>> 0;
  st.s2 = ((((st.s2 & 0xfffffff8) << 4) >>> 0) ^ ((((st.s2 << 2) >>> 0) ^ st.s2) >>> 25)) >>> 0;
  st.s3 = ((((st.s3 & 0xfffffff0) << 17) >>> 0) ^ ((((st.s3 << 3) >>> 0) ^ st.s3) >>> 11)) >>> 0;
  return (st.s1 ^ st.s2 ^ st.s3) >>> 0;
}

/**
 * The per-region seed word. All three taus88 state words are initialized to
 * this same value (their dead low bits - 1, 3 and 4 bits respectively - are
 * why seed0's bit 0 has no effect on the map).
 *
 * Region size is deliberately absent: it is only the final modulus, not part
 * of the RNG key, so the same draw stream underlies every region size.
 */
export function spotSeedWord(key: SpotRegionKey): number {
  // Products stay below 2^53, so plain number arithmetic is exact here.
  let w =
    (SEED_BASE +
      SEED1_PRIME * (key.seed1 >>> 0) +
      RX_PRIME * key.regionX +
      RY_PRIME * key.regionY) %
    M32;
  if (w < 0) w += M32;
  return Math.max((w ^ key.seed0) >>> 0, MIN_SEED_WORD);
}

/**
 * The first `count` candidate points of a region, in generation order, as world
 * coordinates. Each candidate consumes exactly two draws (x then y):
 *
 *   coord = region * region_size + (draw mod region_size) - region_size/2
 *
 * `suggested_minimum_candidate_point_spacing` does not consume draws - spacing
 * is enforced during spot selection, downstream of this stream.
 */
export function spotCandidatePoints(
  key: SpotRegionKey,
  regionSize: number,
  count: number,
): Array<{ x: number; y: number }> {
  const word = spotSeedWord(key);
  const st: Taus88State = { s1: word, s2: word, s3: word };
  const half = Math.floor(regionSize / 2);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const vx = taus88Next(st);
    const vy = taus88Next(st);
    points.push({
      x: key.regionX * regionSize + (vx % regionSize) - half,
      y: key.regionY * regionSize + (vy % regionSize) - half,
    });
  }
  return points;
}
