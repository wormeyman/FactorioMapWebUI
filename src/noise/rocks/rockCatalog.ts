// Constants and pure helpers for the Nauvis rocks overlay, transcribed from
// factorio-data @ 2.1.11 (base/prototypes/decorative/decoratives.lua and
// base/prototypes/noise-expressions.lua). All three charted rock prototypes
// (huge-rock, big-rock, big-sand-rock) share this map_color.
export const ROCK_SEED1 = 137;
export const ROCK_MAP_COLOR: readonly [number, number, number] = [129, 105, 78];

// Interim footprint threshold. Rock placement probabilities are small (peak
// ~0.25 at seed 123456, most tiles well under that), so this is NOT 0.5. At 0.02
// the overlay paints ~1.6% of the 1024-tile origin region as scattered 1px specks
// (measured), which reads as sparse rocks rather than a blob. This is deliberately
// NOT matched pixel-for-pixel against the game's own preview: the game charts each
// placed rock by its large collision-box footprint (huge-rock ~3x2 tiles), so a
// faithful coverage match needs the per-rock footprint/placement the session-2
// dither project handles - which replaces this render entirely. Tune only enough
// to read as scattered rocks; do not chase the game's exact ink here.
export const ROCK_FOOTPRINT_THRESHOLD = 0.02;

export type RockControls = {
  frequency: number;
  size: number;
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * `range_select_base` (core/prototypes/noise-functions.lua): selects a from-to
 * range, 0 or above inside it, descending outside when `min` < 0.
 *   clamp(min(input - from, to - input) / slope, min, max)
 */
export function rangeSelectBase(
  input: number,
  from: number,
  to: number,
  slope: number,
  min: number,
  max: number,
): number {
  return clamp(Math.min(input - from, to - input) / slope, min, max);
}

/**
 * `slider_rescale` (core/prototypes/noise-functions.lua): maps the 1/6..6 slider
 * output to a 1/n..n range: `2^(log2(v)/log2(6)*log2(n))`. At the default v=1 this
 * is exactly 1, which is the only value the oracle validates point-by-point (non-
 * default size is a faithful port but not point-validated, same as moisture/aux).
 */
export function sliderRescale(v: number, n: number): number {
  if (v === 1) return 1;
  return 2 ** ((Math.log2(v) / Math.log2(6)) * Math.log2(n));
}
