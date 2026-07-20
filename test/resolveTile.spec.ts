import { describe, expect, it } from "vite-plus/test";
import fixture123456 from "./fixtures/oracle-tile-names.seed123456.json";
import fixture424242 from "./fixtures/oracle-tile-names.seed424242.json";
import fixture654321 from "./fixtures/oracle-tile-names.seed654321.json";
import { makeAux } from "../src/noise/expressions/aux";
import { makeElevationNauvis } from "../src/noise/expressions/elevationNauvis";
import { makeMoisture } from "../src/noise/expressions/moisture";
import { makeTileCatalog } from "../src/noise/tiles/catalog";
import { makeTileResolver } from "../src/noise/tiles/resolve";

// Task 10: resolveTile (argmax) parity against the game's own get_tile ground
// truth. Each fixture is 51 positions on the DEFAULT preset (default Nauvis
// elevation + default climate controls); 3 fixtures x 51 = 153 points total.
const FIXTURES = [fixture123456, fixture424242, fixture654321];

interface Mismatch {
  seed0: number;
  x: number;
  y: number;
  expected: string;
  got: string;
  top2Gap: number;
}

describe("makeTileResolver reproduces the game's get_tile ground truth", () => {
  it("matches the game's tile name on >= 90% of 153 points, and any mismatch is near a boundary seam", () => {
    let total = 0;
    let matches = 0;
    const mismatches: Mismatch[] = [];

    for (const fixture of FIXTURES) {
      const resolveAt = makeTileResolver({ seed0: fixture.seed0 });
      // Rebuild the same evaluators the resolver builds internally, purely to
      // compute the top-2 probability gap for any mismatch (the resolver
      // itself only exposes the winning Tile, not the full probability
      // vector).
      const catalog = makeTileCatalog(fixture.seed0);
      const elevationAt = makeElevationNauvis({ seed0: fixture.seed0 });
      const auxAt = makeAux({ seed0: fixture.seed0 });
      const moistureAt = makeMoisture({ seed0: fixture.seed0 });

      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const expected = fixture.tileNames[i];
        const got = resolveAt(p.x, p.y).name;
        total++;

        if (got === expected) {
          matches++;
          continue;
        }

        const env = {
          x: p.x,
          y: p.y,
          elevation: elevationAt(p.x, p.y),
          aux: auxAt(p.x, p.y),
          moisture: moistureAt(p.x, p.y),
        };
        const probs = catalog.map((t) => t.probability(env)).sort((a, b) => b - a);
        const top2Gap = probs[0] - probs[1];
        mismatches.push({ seed0: fixture.seed0, x: p.x, y: p.y, expected, got, top2Gap });
      }
    }

    const pct = (matches / total) * 100;
    const report = mismatches
      .map(
        (m) =>
          `seed=${m.seed0} (${m.x},${m.y}) expected=${m.expected} got=${m.got} top2Gap=${m.top2Gap.toExponential(3)}`,
      )
      .join("\n");
    // eslint-disable-next-line no-console
    console.log(
      `resolveTile parity: ${matches}/${total} (${pct.toFixed(1)}%) exact match.\n` +
        (mismatches.length > 0 ? `Mismatches:\n${report}` : "No mismatches."),
    );

    expect(
      pct,
      `exact-match percentage (see console log for mismatches)\n${report}`,
    ).toBeGreaterThanOrEqual(90);

    for (const m of mismatches) {
      expect(
        m.top2Gap,
        `mismatch at seed=${m.seed0} (${m.x},${m.y}) expected=${m.expected} got=${m.got} should be a near-boundary seam (top-2 gap < 1e-2)`,
      ).toBeLessThan(1e-2);
    }
  });
});
