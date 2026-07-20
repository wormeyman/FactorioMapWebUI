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

/**
 * Maps a geometric "slider" value `s` (the same 1..6-ish scale the game's
 * frequency/size/richness sliders use) onto a linear `[lo, hi]` range:
 *
 *   slider_to_linear(s, lo, hi) = lo + 0.5*(hi-lo) * (1 + log2(s)/log2(6))
 *
 * `s = 1` (the default, un-adjusted slider position) lands at the midpoint of
 * `[lo, hi]`; `s = 6` lands at `hi`. Used by `moisture_nauvis`'s starting-area
 * bias term (`starting_area_moisture_size` -> `startingBiasChange`); reused by
 * any other climate/terrain lever built on the same slider convention.
 */
export function sliderToLinear(s: number, lo: number, hi: number): number {
  return lo + 0.5 * (hi - lo) * (1 + log2(s) / log2(6));
}
