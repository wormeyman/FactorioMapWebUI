import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-trees.seed123456.json";
import { makeTreeShared } from "../src/noise/trees/treeShared";
import { makeTreeSpeciesFields } from "../src/noise/trees/treeField";
import { asymmetricRamps } from "../src/noise/trees/asymmetricRamps";
import { distanceFromNearestPoint } from "../src/noise/distanceFromNearestPoint";
import { makeMoisture } from "../src/noise/expressions/moisture";
import { makeTemperature } from "../src/noise/expressions/temperature";
import { makeMultioctaveNoise } from "../src/noise/multioctaveNoise";
import { TREE_SPECIES } from "../src/noise/trees/treeCatalog";

const { seed0, positions, values } = fixture as {
  seed0: number;
  positions: Array<{ x: number; y: number }>;
  values: Record<string, number[]>;
};

/**
 * Tolerance idiom borrowed from test/resourcePatches.spec.ts: an absolute bound
 * for near-spawn points plus a relative escape for the known far-field basisNoise
 * f32 floor, so the far ring cannot mask a real near-field error.
 */
const agrees = (actual: number, expected: number, abs: number, rel: number): boolean =>
  Math.abs(actual - expected) < abs || Math.abs(actual - expected) < rel * Math.abs(expected);

describe("tree shared fields match the game", () => {
  const { smallNoise, forestPathCutoutFaded } = makeTreeShared({ seed0 });

  it.each([
    ["tree_small_noise", smallNoise],
    ["trees_forest_path_cutout_faded", forestPathCutoutFaded],
  ] as const)("reproduces %s to the noise floor", (name, evalAt) => {
    let worst = 0;
    let label = "";
    positions.forEach((p, i) => {
      const err = Math.abs(evalAt(p.x, p.y) - values[name][i]);
      if (err > worst) {
        worst = err;
        label = `@(${p.x},${p.y})`;
      }
    });
    // Observed worst (2026-07-21, Factorio 2.1.11, seed 123456): tree_small_noise
    // 9.20e-4 (at the deepest far-ring point, where the f32 coordinate floor inside
    // basisNoise bites hardest), trees_forest_path_cutout_faded 5.65e-5. Do not
    // loosen above 1e-3.
    expect(worst, `${name} worst ${label}`).toBeLessThan(1e-3);
  });
});

describe("every tree species matches the game", () => {
  const fields = makeTreeSpeciesFields({ seed0 });

  it("covers all 15 species in the fixture", () => {
    for (const f of fields) expect(values[f.species.name], f.species.name).toBeDefined();
  });

  /**
   * KNOWN CATALOG BUG (found by this oracle run, 2026-07-21): tree_05 and tree_07
   * disagree with the game by a near-constant ~0.05, everywhere, regardless of
   * position - not the noise floor. Root-caused against
   * ~/GitHub/factorio-data @ 2.1.11, base/prototypes/entity/trees.lua:4034 and
   * :4091: every OTHER species' expression has the term
   * `- 0.5 + 0.2 * control:trees:size`, but tree_05 and tree_07 use
   * `- 0.45 + 0.2 * control:trees:size` - a per-species exception the shared
   * formula in treeCatalog.ts/treeField.ts (sizeTerm = -0.5 + 0.2*treesSize,
   * applied uniformly to all 15 rows) does not model. See the "known bug"
   * describe block below, which reproduces the corrected -0.45 constant locally
   * (without touching src/noise/trees/*) and confirms that is the ENTIRE
   * discrepancy - both species close to the same noise floor as everyone else
   * once that one constant is corrected.
   *
   * These two cases are therefore expected, DOCUMENTED failures, not tolerance
   * slop: the tolerance below is deliberately left at the true noise floor
   * (matching the other 13 species) rather than loosened to ~0.06 to paper over
   * this. Fixing it belongs in treeCatalog.ts (add a per-species size-offset
   * field, defaulting to -0.5, overridden to -0.45 for tree_05/tree_07) - out of
   * scope for this oracle-validation task.
   */
  it.each(fields.map((f) => [f.species.name, f] as const))(
    "reproduces %s to the noise floor",
    (name, field) => {
      let worst = 0;
      let label = "";
      positions.forEach((p, i) => {
        const err = Math.abs(field.evalAt(p.x, p.y) - values[name][i]);
        if (err > worst) {
          worst = err;
          label = `@(${p.x},${p.y})`;
        }
      });
      // Species values live in roughly [-3, 0.45]; the dominant error source is
      // the f32 coordinate floor inside basisNoise. Observed worst among the 13
      // species NOT affected by the known bug above (2026-07-21, Factorio 2.1.11,
      // seed 123456): 7.71e-4 (tree_02). tree_05 and tree_07 are EXPECTED to fail
      // this assertion (worst ~0.05, see the comment above) - that is the real
      // finding, not a fixture or tolerance problem. Do not loosen above 1e-3.
      expect(worst, `${name} worst ${label}`).toBeLessThan(1e-3);
    },
  );

  // Consequence of the same known bug: at sample points where tree_05 or tree_07
  // is the winning (max) species, the composed field inherits their ~0.05 error.
  // Left unmodified (not loosened) for the same reason as above.
  it("agrees on the composed max at every sampled point", () => {
    positions.forEach((p, i) => {
      const expected = Math.min(1, Math.max(0, ...fields.map((f) => values[f.species.name][i])));
      const actual = Math.min(1, Math.max(0, ...fields.map((f) => f.evalAt(p.x, p.y))));
      expect(agrees(actual, expected, 1e-3, 1e-2), `@(${p.x},${p.y})`).toBe(true);
    });
  });
});

/**
 * Proves the root-cause diagnosis above: reproducing each species' expression
 * locally (mirroring treeField.ts's evalAt, without importing or modifying it)
 * but with a per-species `sizeOffset` (-0.5 for every species except tree_05 and
 * tree_07, which use -0.45 per trees.lua:4034/:4091) closes the ~0.05 gap to the
 * same noise floor as the other 13 species. This is the whole discrepancy - no
 * second bug is hiding underneath it.
 */
describe("known bug: tree_05/tree_07 size-term constant (trees.lua:4034, :4091)", () => {
  const temperature = makeTemperature({ seed0 });
  const moisture = makeMoisture({ seed0 });
  const { smallNoise, forestPathCutoutFaded } = makeTreeShared({ seed0 });
  const startingPositions = [{ x: 0, y: 0 }];

  const sizeOffset = (name: string): number =>
    name === "tree_05" || name === "tree_07" ? -0.45 : -0.5;

  const correctedEvalAt =
    (name: string) =>
    (x: number, y: number): number => {
      const species = TREE_SPECIES.find((s) => s.name === name)!;
      const noise = makeMultioctaveNoise({
        seed0,
        seed1: species.seed1,
        octaves: 3,
        persistence: 0.65,
        inputScale: 1 / species.inputScaleDiv,
        outputScale: species.outputScale,
      });
      const distance = distanceFromNearestPoint(x, y, startingPositions);
      const climate = Math.min(
        0,
        asymmetricRamps(temperature(x, y), ...species.tempRamp),
        asymmetricRamps(moisture(x, y), ...species.moistRamp),
      );
      const sum =
        climate +
        Math.min(0, distance / 20 - 3) +
        (sizeOffset(name) + 0.2 * 1) +
        smallNoise(x, y) * 0.1 +
        noise(x, y);
      return Math.min(species.cap, forestPathCutoutFaded(x, y), sum);
    };

  it.each(["tree_05", "tree_07"] as const)(
    "the -0.45 constant fully explains %s (matches the noise floor once corrected)",
    (name) => {
      const evalAt = correctedEvalAt(name);
      let worst = 0;
      let label = "";
      positions.forEach((p, i) => {
        const err = Math.abs(evalAt(p.x, p.y) - values[name][i]);
        if (err > worst) {
          worst = err;
          label = `@(${p.x},${p.y})`;
        }
      });
      // Observed worst with the corrected constant (2026-07-21): tree_05 3.15e-4,
      // tree_07 2.92e-4 - both land in the same ~1e-3 noise floor as the 13
      // unaffected species, confirming the -0.45 constant is the entire fix.
      expect(worst, `${name} (corrected) worst ${label}`).toBeLessThan(1e-3);
    },
  );
});
