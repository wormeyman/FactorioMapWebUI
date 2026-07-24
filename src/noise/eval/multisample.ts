/**
 * The native `multisample(expression, offset_x, offset_y)` builtin. Recovered
 * from the headless oracle (`test/oracle/capture.ts multisample`, fixture
 * `test/fixtures/oracle-multisample.seed123456.json`) - see
 * `docs/noise/vulcanus-multisample-NOTES.md` for the derivation.
 *
 * The rule is a plain integer coordinate shift, NOT a half-tile supersample:
 * `multisample(expression, dx, dy)` at `(x, y)` equals `expression` evaluated
 * at `(x + dx, y + dy)`. Confirmed exact (residual 0, not merely under the f32
 * floor) across a wide `(dx, dy)` sweep with no cross term between the axes.
 *
 * `sampleAt` stands in for the game's "separate noise program with a larger
 * grid" - the caller's inner-expression port, evaluated at the shifted point.
 */
export function multisample(
  sampleAt: (x: number, y: number) => number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): number {
  return sampleAt(x + dx, y + dy);
}
