import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-resource-starting.seed123456.json";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import { makeResourcePatches } from "../src/noise/resources/resourcePatches";

const paramsByName = new Map(RESOURCE_CATALOG.map((r) => [r.name, r]));
const relErr = (port: number, game: number) => Math.abs(port - game) / Math.max(1, Math.abs(game));
const ABS_TOL = 1.0;
const REL_TOL = 1e-2;

// This fixture samples both the near-spawn starting patches (the feature under
// test) AND the pre-existing far field (d=1500-2500), at large fractional
// coordinates. The starting patches match the game to well under 1.0 abs, but
// the far-field regular basisNoise term hits its inherent f32 (single-precision)
// coordinate-precision floor out there: absolute error up to ~5.3 on field
// values of ~10,000, i.e. relative error <= ~5e-4. That is 20x-200x inside the
// 1e-2 relative gate but busts a flat 1.0 absolute gate.
//
// A single f32 noise field spanning ~[-14000, +thousands] needs a COMBINED
// tolerance: an absolute floor for small-magnitude values (catches real bugs
// near zero, where relative error is meaningless) and a relative gate for
// large-magnitude values (accommodates the f32 floor without masking real
// errors). A point only fails if it violates BOTH gates. See
// docs/noise/random-penalty-NOTES.md and the M1 elevation f32-floor precedent
// for the same pattern. regularPatches.spec (M3a) still owns the strict,
// unrelaxed check on the unchanged regular field alone.
describe("makeResourcePatches (all_patches = max(starting, regular) vs oracle)", () => {
  for (const c of fixture.cases) {
    it(`matches the game for ${c.resource} seed=${c.seed}`, () => {
      const params = paramsByName.get(c.resource)!;
      const patches = makeResourcePatches(params, {
        seed0: c.seed,
        controls: { frequency: 1, size: 1, richness: 1 },
        regularSkipSpan: 1,
        regularSkipOffset: 0,
        startingSkipSpan: 1,
        startingSkipOffset: 0,
      });
      const mism: { x: number; y: number; game: number; port: number; abs: number; rel: number }[] =
        [];
      const offenders: (typeof mism)[number][] = [];
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const game = c.values[i];
        const port = patches.field(p.x, p.y);
        const abs = Math.abs(port - game);
        const rel = relErr(port, game);
        const entry = { x: p.x, y: p.y, game, port, abs, rel };
        mism.push(entry);
        if (abs >= ABS_TOL && rel >= REL_TOL) offenders.push(entry);
      }
      if (offenders.length > 0) {
        const top = offenders
          .sort((a, b) => b.rel - a.rel)
          .slice(0, 12)
          .map(
            (m) =>
              `  (${m.x},${m.y}) game=${m.game.toFixed(2)} port=${m.port.toFixed(2)} abs=${m.abs.toFixed(3)} rel=${m.rel.toExponential(2)}`,
          )
          .join("\n");
        throw new Error(
          `${c.resource} seed=${c.seed}: ${offenders.length}/${mism.length} points fail BOTH abs<${ABS_TOL} and rel<${REL_TOL}\n${top}`,
        );
      }
      expect(offenders.length).toBe(0);
    });
  }
});
