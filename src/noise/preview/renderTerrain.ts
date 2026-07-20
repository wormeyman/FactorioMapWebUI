import { makeElevationNauvis } from "../expressions/elevationNauvis";
import { makeTileCatalog } from "../tiles/catalog";
import { waterBase } from "../tiles/helpers";
import { makeTileResolver, type TileResolverParams } from "../tiles/resolve";

export interface RenderTerrainOptions {
  /** Map seed (= map_seed / seed0). Callers resolve a null "random" seed first. */
  readonly seed0: number;
  /** Output pixel dimensions. */
  readonly width: number;
  readonly height: number;
  /** World tile at the top-left pixel. Default (0, 0). */
  readonly originX?: number;
  readonly originY?: number;
  /** World tiles per pixel. Default 1. */
  readonly tilesPerPixel?: number;
  /** Non-seed resolver params (currently just segmentationMultiplier). */
  readonly ctx?: Omit<TileResolverParams, "seed0">;
}

/**
 * Water early-out threshold, in `water_base(elevation, 0, 100)` units (Task 11).
 *
 * Every one of the 19 land tiles is `expressionInRangeBase(...) [<= 1] (+max
 * with another such term, still <= 1) + noiseLayerNoise(x, y)`, except sand-1,
 * whose extra unbounded coastal term is capped by its own (aux) box regardless
 * of elevation. `noiseLayerNoise` is a 4-octave `multioctave_noise` built on
 * `basisNoise`; both are provably bounded (not just empirically observed) by
 * Cauchy-Schwarz - `basisNoise`'s 4 corner terms are each `<= (1-d)^3 * sqrt(d) *
 * GRADIENT_MAGNITUDE`, maximized over d in [0,1) at `d = 1/7` for a single term
 * (~1.0), and jointly over all 4 corners (numeric search) at `~1.7719`; summing
 * the 4 octaves' amplitudes (`norm * sum((1/persistence)^k)` for persistence
 * 0.7, 4 octaves ~= 1.8634) and applying `outputScale = 2/3` gives a hard bound
 * `|noiseLayerNoise| <= (2/3) * 1.7719 * 1.8634 ~= 2.2012` - true for ANY (x, y)
 * and ANY of the 19 layer seeds, not just the ones sampled. (An empirical sweep
 * of 20,000 points per seed across all 19 layer seeds found an observed max of
 * ~1.84, comfortably under this bound, which is the expected relationship for a
 * valid-but-not-maximally-tight analytic bound.)
 *
 * sand-1's extra term `expression_in_range(5, inf, [elevation, aux], [-1.5, 0.5],
 * [1.5, 1])` is unbounded in `peak_maximum`, but its value is `5 * min(elevation
 * + 1.5, 1.5 - elevation, aux - 0.5, 1 - aux)`, and the `aux` pair alone caps the
 * min at `0.25` (half-width of `[0.5, 1]`) regardless of `elevation` - so this
 * term is <= 1.25 unconditionally, a bit above the general 1.0 cap.
 *
 * So the true worst-case land probability, over every tile and every point, is
 * `<= max(1, 1.25) + 2.2012 = 3.4512`. Choosing `WATER_EARLY_OUT_THRESHOLD = 5`
 * leaves a >=30% margin over that proven bound: whenever
 * `water_base(elevation, 0, 100) >= 5`, that value (or `deepwater`'s, if
 * higher - the early-out compares them directly) exceeds every land tile's
 * probability, so picking water/deepwater directly reproduces the full
 * resolver's argmax winner exactly.
 *
 * The design doc's own back-of-envelope estimate ("land tops out at peak_maximum(1)
 * + noise_layer_noise(+/-~0.67)" ~= 1.67) undershoots the true bound - the
 * empirical sweep alone found points past 1.8 - so this task deliberately uses
 * 5, not 1.67, as the threshold. See the task report for the full derivation and
 * the equivalence test that validates it over a live grid.
 */
const WATER_EARLY_OUT_THRESHOLD = 5;

/**
 * Sweep a `width x height` pixel grid over world space and return an `ImageData`
 * painted with each pixel's winning tile's `map_color` (Task 11 - the terrain
 * color render path, `makeTileResolver`'s argmax turned into pixels).
 *
 * Performance: most open-water pixels skip the 19 land `noise_layer_noise`
 * evaluations via a provably-safe early-out (see {@link WATER_EARLY_OUT_THRESHOLD}) -
 * only `elevation` and the two `water_base` terms are evaluated there. Pixels
 * near the coast or on land still run the full resolver.
 */
export function renderTerrain(opts: RenderTerrainOptions): ImageData {
  const { width, height, seed0 } = opts;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const tpp = opts.tilesPerPixel ?? 1;

  const resolve = makeTileResolver({ seed0, ...opts.ctx });
  const elevationAt = makeElevationNauvis({
    seed0,
    segmentationMultiplier: opts.ctx?.segmentationMultiplier,
  });
  const catalog = makeTileCatalog(seed0);
  const deepwaterTile = catalog.find((t) => t.name === "deepwater")!;
  const waterTile = catalog.find((t) => t.name === "water")!;

  const data = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    const wy = originY + py * tpp;
    for (let px = 0; px < width; px++) {
      const wx = originX + px * tpp;

      const elevation = elevationAt(wx, wy);
      const waterInfluence = waterBase(elevation, 0, 100);

      let color: readonly [number, number, number, number];
      if (waterInfluence >= WATER_EARLY_OUT_THRESHOLD) {
        // Water/deepwater necessarily beat every land tile here (see the
        // threshold derivation above); pick between the two directly, matching
        // the full resolver's tie-break (deepwater is catalog[0], so a strict
        // `>` never lets water displace it on an exact tie).
        const deepInfluence = waterBase(elevation, -2, 200);
        color = deepInfluence >= waterInfluence ? deepwaterTile.color : waterTile.color;
      } else {
        color = resolve(wx, wy).color;
      }

      const o = (py * width + px) * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = color[3];
    }
  }

  return new ImageData(data, width, height);
}
