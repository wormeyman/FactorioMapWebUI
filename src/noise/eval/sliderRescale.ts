/**
 * `slider_rescale` (core/prototypes/noise-functions.lua): maps the 1/6..6 slider
 * output to a 1/n..n range: `2^(log2(v)/log2(6)*log2(n))`. At the default v=1 this
 * is exactly 1, which is the only value the oracle validates point-by-point (non-
 * default size is a faithful port but not point-validated, same as moisture/aux).
 *
 * Extracted from the Nauvis rocks overlay (the first and, until Vulcanus, only
 * consumer - see `src/noise/rocks/rockCatalog.ts`) so `starting_spot_at_angle`'s
 * Vulcanus siblings can share it without a `rocks/`-flavored import.
 */
export function sliderRescale(v: number, n: number): number {
  if (v === 1) return 1;
  return 2 ** ((Math.log2(v) / Math.log2(6)) * Math.log2(n));
}
