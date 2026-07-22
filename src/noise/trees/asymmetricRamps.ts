/**
 * `asymmetric_ramps` from core/prototypes/noise-functions.lua:114-124.
 *
 * Two opposing linear ramps combined with `min`: output crosses 0 at `fromTop`
 * and `toTop`, and -1 at `fromBottom` and `toBottom`. The peak value depends on
 * how far apart the tops are, so it is positive when they are apart and negative
 * when they cross each other.
 *
 * There is deliberately no clamp and no upper bound - the game's comment says it
 * is "designed to be used with a group of asymmetric_ramps inside a shared min()",
 * which is exactly how every tree species uses it.
 */
export function asymmetricRamps(
  input: number,
  fromBottom: number,
  fromTop: number,
  toTop: number,
  toBottom: number,
): number {
  return Math.min((input - fromTop) / (fromTop - fromBottom), (toTop - input) / (toBottom - toTop));
}
