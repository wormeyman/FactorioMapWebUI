/**
 * Wrap a pure `(x, y) => number` field in a single-slot cache keyed on the last
 * `(x, y)` it was called with.
 *
 * The Vulcanus field graph is a heavily-shared DAG: a single node like
 * `mountains_raw_volcano` feeds all three biomes, and each biome is read ~5x by
 * the 19 tile `*_range` expressions, so a naive lazy-closure evaluation
 * recomputes each node - and every `basis_noise` octave beneath it - dozens of
 * times per pixel. A renderer sweeps one pixel at a time and reads every node at
 * that single `(x, y)`, so a one-entry cache collapses those repeat reads to one
 * evaluation per node per pixel.
 *
 * Byte-exact by construction: it returns the *identical* float the wrapped
 * function computed (cached, not recomputed-and-rounded), so a memoized field
 * graph produces bit-for-bit the same render as the un-memoized one. The cache is
 * keyed on exact `===` equality of both coordinates, so any change in either
 * coordinate (including the off-pixel spot coordinates a region selection probes)
 * recomputes rather than returning a stale value - correctness never depends on
 * the caller staying on one pixel, only efficiency does.
 */
export function memoXY(fn: (x: number, y: number) => number): (x: number, y: number) => number {
  // NaN sentinels: NaN !== NaN, so the very first call always misses. World
  // coordinates are finite, so a real call never collides with the sentinel.
  let lastX = NaN;
  let lastY = NaN;
  let value = 0;
  return (x: number, y: number): number => {
    if (x === lastX && y === lastY) return value;
    lastX = x;
    lastY = y;
    value = fn(x, y);
    return value;
  };
}
