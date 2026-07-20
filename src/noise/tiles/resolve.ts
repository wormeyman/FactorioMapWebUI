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
 */
export function makeTileResolver(params: TileResolverParams): (x: number, y: number) => Tile {
  const seed0 = params.seed0;
  const segmentationMultiplier = params.segmentationMultiplier ?? 1;

  const elevationAt = makeElevationNauvis({ seed0, segmentationMultiplier });
  const auxAt = makeAux({ seed0, segmentationMultiplier });
  const moistureAt = makeMoisture({ seed0, segmentationMultiplier });
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
