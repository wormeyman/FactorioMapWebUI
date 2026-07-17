import { describe, expect, it } from "vite-plus/test";
import seeding from "./fixtures/basis-noise-seeding.game.json";
import { basisNoise, basisNoiseTablesFromSeed } from "../src/noise/basisNoise";

// Ground truth captured from Factorio 2.1.11 via calculate_tile_properties,
// routing basis_noise{seed0, seed1} onto `elevation`. See
// docs/noise/basis-noise-NOTES.md for the seed -> tables derivation.

describe("basisNoiseTablesFromSeed", () => {
  it("reproduces the game across the seed combine, the salt and the clamp", () => {
    for (const c of seeding.cases) {
      const tables = basisNoiseTablesFromSeed(c.seed0, c.seed1);
      let worst = 0;
      seeding.points.forEach((p, i) => {
        const got = basisNoise(p.x * seeding.inputScale, p.y * seeding.inputScale, tables);
        worst = Math.max(worst, Math.abs(got - c.values[i]));
      });
      // ~2e-6 is the game's own fastapprox noise floor; stay comfortably under.
      expect(worst, `seed0=${c.seed0} seed1=${c.seed1}`).toBeLessThan(1e-5);
    }
  });

  it("clamps every seed0 in 0..341 to one field (the 0x155 taus88 clamp)", () => {
    // A cheap fingerprint of the whole field: a few non-lattice sample values.
    const fp = (s0: number) => {
      const t = basisNoiseTablesFromSeed(s0, 0);
      return [
        [3.5, 7.25],
        [40.125, 11.75],
        [201.5, 88.375],
      ]
        .map(([x, y]) => basisNoise(x, y, t).toFixed(9))
        .join(",");
    };
    const ref = fp(341);
    for (const s0 of [0, 1, 128, 256, 320, 340, 341]) {
      expect(fp(s0), `seed0=${s0}`).toBe(ref);
    }
    // 342 is the first seed that escapes the clamp.
    expect(fp(342)).not.toBe(ref);
  });

  it("has a dead seed0 bit 0: {2k, 2k+1} collide", () => {
    const fp = (s0: number) => {
      const t = basisNoiseTablesFromSeed(s0, 0);
      return basisNoise(17.5, 3.125, t).toFixed(12);
    };
    for (const k of [500, 1234, 100000]) {
      expect(fp(2 * k), `2k=${2 * k}`).toBe(fp(2 * k + 1));
    }
    // Even neighbours (different k) generally differ.
    expect(fp(1000)).not.toBe(fp(1002));
  });
});
