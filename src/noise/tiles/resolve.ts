import type { Point } from "../distanceFromNearestPoint";
import { makeAux } from "../expressions/aux";
import { makeElevationNauvis } from "../expressions/elevationNauvis";
import { makeMoisture } from "../expressions/moisture";
import { makeTileCatalog } from "./catalog";
import type { Tile } from "./catalog";

export interface TileResolverParams {
  /** Map seed (= map_seed / seed0). */
  readonly seed0: number;
  /** control:water:frequency; default 1. Threads into elevation/aux/moisture. */
  readonly segmentationMultiplier?: number;
  /** control:moisture:frequency; default 1. */
  readonly moistureFrequency?: number;
  /** control:moisture:bias; default 0. */
  readonly moistureBias?: number;
  /** control:aux:frequency; default 1. */
  readonly auxFrequency?: number;
  /** control:aux:bias; default 0. */
  readonly auxBias?: number;
  /** control:starting_area_moisture:size; default 1 (degenerate at default - see makeMoisture). */
  readonly startingAreaMoistureSize?: number;
  /** control:starting_area_moisture:frequency; default 1. */
  readonly startingAreaMoistureFrequency?: number;
  /** Spawn points threaded into elevation/moisture's distance terms. Default single origin spawn. */
  readonly startingPositions?: Point[];
}

/**
 * Task 10: builds the tile-autoplace argmax for one seed (default Nauvis
 * elevation + default climate - freq 1, bias 0 - since this is what the
 * `oracle-tile-names` fixtures capture). Compiles the elevation, aux, moisture
 * evaluators and the 21-tile catalog once, then returns an `(x, y) => Tile`
 * resolver: at each point it evaluates elevation/aux/moisture, evaluates every
 * catalog tile's `probability(env)`, and returns the tile with the maximum
 * probability (argmax; ties keep the first tile in catalog order, since a
 * strict `>` comparison never replaces the running winner on an exact tie).
 *
 * Task 12b: the climate params (moisture/aux frequency+bias, starting-area
 * moisture, startingPositions) all default to the game's own defaults, so
 * calling this with none of them supplied is byte-for-byte the same path
 * Task 10 validated against the oracle at 100%. Non-default climate values are
 * faithful ports of the game's noise-programs.lua tree (same as the
 * already-shipped starting-area/starting-lake elevation levers) but are NOT
 * themselves oracle-validated point-by-point - only the all-defaults path is.
 */
export function makeTileResolver(params: TileResolverParams): (x: number, y: number) => Tile {
  const seed0 = params.seed0;
  const segmentationMultiplier = params.segmentationMultiplier ?? 1;
  const startingPositions = params.startingPositions ?? [{ x: 0, y: 0 }];

  const elevationAt = makeElevationNauvis({ seed0, segmentationMultiplier, startingPositions });
  const auxAt = makeAux({
    seed0,
    segmentationMultiplier,
    frequency: params.auxFrequency,
    bias: params.auxBias,
  });
  const moistureAt = makeMoisture({
    seed0,
    segmentationMultiplier,
    moistureFrequency: params.moistureFrequency,
    moistureBias: params.moistureBias,
    startingAreaMoistureSize: params.startingAreaMoistureSize,
    startingAreaMoistureFrequency: params.startingAreaMoistureFrequency,
    startingPositions,
  });
  const catalog = makeTileCatalog(seed0);

  return (x: number, y: number): Tile => {
    const elevation = elevationAt(x, y);
    const aux = auxAt(x, y);
    const moisture = moistureAt(x, y);
    const env = { x, y, elevation, aux, moisture };

    let winner = catalog[0];
    let winnerProbability = winner.probability(env);
    for (let i = 1; i < catalog.length; i++) {
      const tile = catalog[i];
      const probability = tile.probability(env);
      if (probability > winnerProbability) {
        winner = tile;
        winnerProbability = probability;
      }
    }
    return winner;
  };
}
