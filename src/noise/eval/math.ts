/**
 * Tiny math helpers matching the game's noise DSL operators, so a hand-ported
 * named expression reads 1:1 with the Lua (`min(a, b, c)`, `clamp(x, lo, hi)`, ...).
 */

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolate: `a` at `t=0`, `b` at `t=1`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Variadic min (the DSL's `min(...)`). */
export function min(...xs: number[]): number {
  return Math.min(...xs);
}

/** Variadic max (the DSL's `max(...)`). */
export function max(...xs: number[]): number {
  return Math.max(...xs);
}

/**
 * Base-2 log (the DSL's `log2`, used by `water_level = 10 * log2(control:water:size)`).
 * Plain `Math.log2`; the game's fastapprox variant only matters once the
 * water-coverage slider is wired (default size = 1 => 0, exact either way).
 */
export function log2(x: number): number {
  return Math.log2(x);
}
