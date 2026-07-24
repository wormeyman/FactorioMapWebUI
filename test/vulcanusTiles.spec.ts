import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-vulcanus-tile-names.seed123456.json";
import { makeVulcanusTileResolver } from "../src/noise/tiles/vulcanusCatalog";

/**
 * Task 10: the Vulcanus tile argmax + map_color port, validated against the
 * `get_tile` oracle (Space Age, real Vulcanus surface). `resolveVulcanusTile`
 * evaluates every tile's `probability_expression` and paints the argmax's
 * `map_color` - this asserts it names the SAME tile the game placed.
 *
 * Agreement is NOT expected to be 100%: a few `*_range` expressions reference V2
 * resource fields (`vulcanus_metal_tile`, `vulcanus_calcite_region`,
 * `vulcanus_sulfuric_acid_region_patchy`) that V1 approximates as their no-resource
 * default (see `docs/noise/vulcanus-tiles-NOTES.md`). Those approximations only move
 * the argmax INSIDE a resource patch, so the handful of mismatches should be sparse
 * and localized. A LOW agreement or WIDESPREAD mismatches would instead mean a
 * genuinely wrong range transcription - so the floor here is deliberately high.
 *
 * Measured 96.85% (369/381). The 12 mismatches are all ADJACENT-tile flips within
 * one biome family (folds-flat/folds, smooth-stone/cracks-warm, jagged/folds,
 * soil-light/soil-dark, ash-soil/pumice, ash-flats/ash-light, cracks-hot/cracks-warm),
 * spread across radii 192-2079 - the signature of the known far-field f32 coordinate
 * floor in elevation/aux/moisture tipping a near-tie argmax across a range boundary,
 * plus a few basalt warm/cold flips consistent with the dropped `50000 * metal` term.
 * No single range expression is systematically wrong (that would cluster many cells of
 * one tile), so this is the resource-approximation + precision floor, not a bug.
 */
describe("makeVulcanusTileResolver vs get_tile oracle", () => {
  const resolve = makeVulcanusTileResolver({ seed0: fixture.seed0 });
  const positions = fixture.positions;
  const want = fixture.tileNames;

  it("agrees with the placed tile at a high fraction of positions", () => {
    let agree = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const got = resolve(p.x, p.y).name;
      if (got === want[i]) agree++;
    }
    const agreement = agree / positions.length;
    // Floor 0.95 (measured 0.9685): high enough that a genuinely wrong range
    // transcription fails it, with modest headroom for the boundary-flip count.
    expect(agreement).toBeGreaterThan(0.95);
  });
});
