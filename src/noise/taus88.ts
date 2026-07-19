/**
 * L'Ecuyer taus88, the generator underlying Factorio's noise RNG. Extracted from
 * spotCandidates/basisNoise so every seeding variant shares one bit-exact step.
 * Verified against Factorio 2.1.11.
 */
export interface Taus88State {
  s1: number;
  s2: number;
  s3: number;
}

/** Seed all three state words to the same value (the game's seeding shape). */
export function seededState(word: number): Taus88State {
  return { s1: word >>> 0, s2: word >>> 0, s3: word >>> 0 };
}

/** One canonical taus88 step (output taken after the update). */
export function taus88Next(st: Taus88State): number {
  st.s1 = ((((st.s1 & 0xfffffffe) << 12) >>> 0) ^ ((((st.s1 << 13) >>> 0) ^ st.s1) >>> 19)) >>> 0;
  st.s2 = ((((st.s2 & 0xfffffff8) << 4) >>> 0) ^ ((((st.s2 << 2) >>> 0) ^ st.s2) >>> 25)) >>> 0;
  st.s3 = ((((st.s3 & 0xfffffff0) << 17) >>> 0) ^ ((((st.s3 << 3) >>> 0) ^ st.s3) >>> 11)) >>> 0;
  return (st.s1 ^ st.s2 ^ st.s3) >>> 0;
}
