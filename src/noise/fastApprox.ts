/**
 * Paul Mineiro's `fastapprox` `log2` / `exp2` / `pow`, exactly as Factorio's
 * `Math::log2` / `Math::exp2f` (read out of the 2.1.11 disassembly). The game's
 * noise machine evaluates powers and cube roots through these, so any ported noise
 * expression that takes a `pow`/`cbrt` must go through them too - matching them is
 * what closes the last ~1e-4 relative error.
 *
 * Originally lived in `multioctaveNoise.ts` (for its RMS normalisation power); moved
 * here once the resource `spot_height`/`blob_amplitude` expressions needed the same
 * `cbrt` (see docs/noise/random-penalty-NOTES.md, the fastapprox-cbrt residual).
 */

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

/** `x^p` via the fastapprox pair, as the game computes powers in noise programs. */
export function fastPow(x: number, p: number): number {
  return fastPow2(f32(p * fastLog2(x)));
}

/**
 * `x^(1/3)` via the fastapprox pair - the cube root the game's noise machine uses in
 * `regular_spot_height_typical` / `regular_blob_amplitude` / `starting_blob_amplitude`
 * (and the spot-selection cone radius). `x` must be > 0 (all resource quantities are).
 */
export function fastCbrt(x: number): number {
  return fastPow(x, 1 / 3);
}
