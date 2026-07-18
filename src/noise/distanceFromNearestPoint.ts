/**
 * A reimplementation of Factorio's `distance_from_nearest_point` primitive
 * (`NoiseOperations::DistanceFromNearestPoint`), read directly from its register
 * `run` (`NoiseOperations::DistanceFromNearestPoint::run` @0x101759568) in the
 * non-stripped Factorio 2.1.11 Mach-O. Unlike the multioctave family this needed no
 * oracle fit - it is plain geometry, and its `points` argument is a runtime list the
 * noise DSL will not accept as a literal, so it cannot be probed standalone. It
 * validates indirectly through `finish_elevation` (the elevation tree feeds it
 * `starting_lake_positions`).
 *
 * The shape (per tile):
 *
 *   distance_from_nearest_point(x, y) =
 *       min( maximum_distance , min over p in points of dist((x,y), p) )
 *
 * The disassembly computes it as: seed a running best with `maximum_distance^2`,
 * loop the points tracking the smallest squared distance, then return
 * `bestSq < maximum_distance^2 ? sqrt(bestSq) : maximum_distance`. Points are stored
 * as `int32 = round(coord * 256)` (Factorio's 1/256 fixed-point MapPosition), so the
 * point coordinates are quantised to 1/256 before use - a no-op for the integer tile
 * positions these lists usually hold, replicated here for faithfulness.
 *
 * NOT wired into the app - a building block for a client-side map preview.
 */

/** A point in world tiles. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Factorio stores noise points as 1/256 fixed-point; quantise to match. */
const quantise = (v: number): number => Math.round(v * 256) / 256;

/**
 * Evaluate `distance_from_nearest_point` at world coordinates `(x, y)`: the Euclidean
 * distance to the nearest of `points`, capped at `maximumDistance`. With no points
 * (or all beyond the cap) it returns `maximumDistance`. `maximumDistance` defaults to
 * `Infinity` (uncapped); the game's exact default when the DSL omits it is
 * unconfirmed, but every base-game caller passes one (e.g. the elevation tree's 1024).
 *
 * Pass `points` already reduced to the region of interest when sweeping a grid - the
 * cost is O(points) per tile.
 */
export function distanceFromNearestPoint(
  x: number,
  y: number,
  points: readonly Point[],
  maximumDistance = Infinity,
): number {
  const maxSq = maximumDistance * maximumDistance;
  let bestSq = maxSq;
  for (const p of points) {
    const dx = x - quantise(p.x);
    const dy = y - quantise(p.y);
    const d2 = dx * dx + dy * dy;
    if (d2 < bestSq) bestSq = d2;
  }
  return bestSq < maxSq ? Math.sqrt(bestSq) : maximumDistance;
}
