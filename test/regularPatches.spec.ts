import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-resource-regular.seed123456.json";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import { makeRegularPatches } from "../src/noise/resources/regularPatches";

// Ground truth: resource_autoplace_all_patches with has_starting_area_placement=0
// and regular_patch_set_count=1 (pure, unpartitioned regular field), routed onto
// elevation. See docs/superpowers/plans/2026-07-19-milestone3a-regular-patches.md T3/T4.

const paramsByName = new Map(RESOURCE_CATALOG.map((r) => [r.name, r]));

/** Relative error against a game value, floored so basement magnitudes don't dominate. */
function relErr(port: number, game: number): number {
  return Math.abs(port - game) / Math.max(1, Math.abs(game));
}

// M3a Task 4: the regular resource field, validated point-by-point against the
// game. Two facts about the metric:
//
//   * ABSOLUTE error is the honest floor. The field spans ~[-14000, +thousands]
//     (deep basement -> patch peaks), and the game's spot_noise machine evaluates
//     the whole selection/cone/blob chain in f32 - cube roots via its fastapprox
//     `pow` (src/noise/fastApprox.ts). Matching that (fastCbrt + f32 cone render)
//     pins the port to the game within ~0.7 units EVERYWHERE. We assert < 1.0.
//   * RELATIVE error stays < 1e-3 across the smooth patch interiors, but at cone
//     edges / basement zero-crossings (where |field| is a handful of units) the
//     ~0.7-unit f32 noise inflates to ~9e-3 relative - the same f32 floor M1
//     (elevation_lakes, 7.4e-3) and the Island map type (6.66e-3) documented. We
//     assert < 1e-2, matching that precedent.
//
// Before the f32/fastCbrt work the absolute error was ~3 units and the relative
// worst was 4.8e-2 (exact Math.cbrt); see docs/noise/random-penalty-NOTES.md
// "Composition inside spot selection" and the fastapprox-cbrt residual.
const ABS_TOL = 1.0;
const REL_TOL = 1e-2;

describe("makeRegularPatches (regular resource field vs oracle)", () => {
  for (const c of fixture.cases) {
    it(`matches the game for ${c.resource} seed=${c.seed}`, () => {
      const params = paramsByName.get(c.resource)!;
      const patches = makeRegularPatches(params, {
        seed0: c.seed,
        controls: { frequency: 1, size: 1, richness: 1 },
        skipSpan: 1,
        skipOffset: 0,
      });

      let worstAbs = 0;
      let worstRel = 0;
      const mism: { x: number; y: number; game: number; port: number; abs: number; rel: number }[] =
        [];
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const game = c.values[i];
        const port = patches.field(p.x, p.y);
        const abs = Math.abs(port - game);
        const rel = relErr(port, game);
        if (abs > worstAbs) worstAbs = abs;
        if (rel > worstRel) worstRel = rel;
        mism.push({ x: p.x, y: p.y, game, port, abs, rel });
      }

      if (worstAbs >= ABS_TOL || worstRel >= REL_TOL) {
        const top = [...mism]
          .sort((a, b) => b.abs - a.abs)
          .slice(0, 8)
          .map(
            (m) =>
              `  (${m.x},${m.y}) game=${m.game.toFixed(2)} port=${m.port.toFixed(2)} abs=${m.abs.toFixed(3)} rel=${m.rel.toExponential(2)}`,
          )
          .join("\n");
        throw new Error(
          `${c.resource} seed=${c.seed}: worstAbs=${worstAbs.toFixed(3)} (tol ${ABS_TOL}) ` +
            `worstRel=${worstRel.toExponential(3)} (tol ${REL_TOL.toExponential(0)})\n` +
            `largest-absolute mismatches:\n${top}`,
        );
      }
      expect(worstAbs).toBeLessThan(ABS_TOL);
      expect(worstRel).toBeLessThan(REL_TOL);
    });
  }
});
