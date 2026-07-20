/**
 * The native Factorio `expression_in_range(peak_multiplier, peak_maximum,
 * expr_1..N, from_1..N, to_1..N)` builtin, reverse-engineered from the headless
 * oracle (see docs/noise/expression-in-range-NOTES.md). Used by the tile-autoplace
 * system to make a tile probable only inside an N-dimensional box of climate
 * values, with a linear falloff outside.
 *
 * Derived formula (worst residual ~9.5e-7 across the full oracle sweep):
 *
 *   m      = min over all dims i of min(value_i - from_i, to_i - value_i)
 *   result = min(peak_maximum, peak_multiplier * m)
 *
 * Per dimension, `min(value - from, to - value)` is the signed distance to the
 * nearer edge of `[from, to]`: positive inside, zero on an edge, negative outside.
 * Taking the min across dims makes the box a hard AND (any dim out of range pulls
 * the result down). Scaling by `peak_multiplier` sets the falloff slope; clamping
 * at `peak_multiplier * m` <= `peak_maximum` caps the in-range plateau. There is NO
 * lower clamp - the value falls linearly without bound outside the range.
 *
 * `peak_maximum` may be `Infinity` (sand-1's unbounded coastal term
 * `expression_in_range(5, inf, ...)`), in which case the plateau is uncapped and
 * in-range values exceed 1 (~`peak_multiplier * halfWidth`). Do NOT clamp that case.
 */
export function expressionInRange(
  peakMultiplier: number,
  peakMaximum: number,
  values: number[],
  froms: number[],
  tos: number[],
): number {
  let m = Infinity;
  for (let i = 0; i < values.length; i++) {
    const edgeDistance = Math.min(values[i] - froms[i], tos[i] - values[i]);
    if (edgeDistance < m) m = edgeDistance;
  }
  return Math.min(peakMaximum, peakMultiplier * m);
}
