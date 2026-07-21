import { describe, expect, it } from "vite-plus/test";
import elevFixture from "./fixtures/oracle-cliff-elevation.seed123456.json";
import cliffinessFixture from "./fixtures/oracle-cliffiness.seed123456.json";
import { makeCliffElevation, makeCliffiness } from "../src/noise/cliffs/cliffFields";

const ABS_TOL = 1.0,
  REL_TOL = 1e-2;
const ok = (p: number, g: number) => Math.abs(p - g) < Math.max(ABS_TOL, REL_TOL * Math.abs(g));
const ctx = (seed0: number) => ({
  seed0,
  controls: { frequency: 1, continuity: 1 },
  settings: { cliffElevation0: 10, cliffElevationInterval: 40, richness: 1 },
});

describe("makeCliffElevation vs oracle", () => {
  for (const c of elevFixture.cases) {
    it(`matches cliff_elevation_nauvis seed=${c.seed}`, () => {
      const f = makeCliffElevation(ctx(c.seed));
      let worstAbs = 0;
      for (let i = 0; i < elevFixture.positions.length; i++) {
        const p = elevFixture.positions[i];
        const port = f(p.x, p.y),
          game = c.values[i];
        worstAbs = Math.max(worstAbs, Math.abs(port - game));
        expect(ok(port, game)).toBe(true);
      }
      expect(worstAbs).toBeLessThan(ABS_TOL * 10); // sanity: not wildly off
    });
  }
});

describe("makeCliffiness vs oracle (exact 0/10 gate)", () => {
  for (const c of cliffinessFixture.cases) {
    it(`matches cliffiness_nauvis seed=${c.seed}`, () => {
      const f = makeCliffiness(ctx(c.seed));
      const mism: string[] = [];
      for (let i = 0; i < cliffinessFixture.positions.length; i++) {
        const p = cliffinessFixture.positions[i];
        const port = f(p.x, p.y),
          game = c.values[i];
        if (port !== game) mism.push(`(${p.x},${p.y}) game=${game} port=${port}`);
      }
      if (mism.length)
        throw new Error(`${mism.length} gate mismatches:\n${mism.slice(0, 12).join("\n")}`);
      expect(mism.length).toBe(0);
    });
  }
});
