import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-resource-starting.seed123456.json";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import { makeResourcePatches } from "../src/noise/resources/resourcePatches";

const paramsByName = new Map(RESOURCE_CATALOG.map((r) => [r.name, r]));
const relErr = (port: number, game: number) => Math.abs(port - game) / Math.max(1, Math.abs(game));
const ABS_TOL = 1.0;
const REL_TOL = 1e-2;

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
          .slice(0, 12)
          .map(
            (m) =>
              `  (${m.x},${m.y}) game=${m.game.toFixed(2)} port=${m.port.toFixed(2)} abs=${m.abs.toFixed(3)} rel=${m.rel.toExponential(2)}`,
          )
          .join("\n");
        throw new Error(
          `${c.resource} seed=${c.seed}: worstAbs=${worstAbs.toFixed(3)} worstRel=${worstRel.toExponential(3)}\n${top}`,
        );
      }
      expect(worstAbs).toBeLessThan(ABS_TOL);
      expect(worstRel).toBeLessThan(REL_TOL);
    });
  }
});
