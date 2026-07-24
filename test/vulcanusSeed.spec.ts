import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-seed-vars.multi.json";
import { seedNormalized, seedSmall } from "../src/noise/expressions/vulcanusSeed";

describe("seedNormalized reproduces the game's map_seed_normalized", () => {
  it("matches every fixture row exactly (f32 relation, tolerance 0)", () => {
    for (const row of fixture.seeds) {
      expect(seedNormalized(row.seed0), `seed0=${row.seed0}`).toBe(row.mapSeedNormalized);
    }
  });

  it("is bit-exact via Math.fround(seed0 / 2^32), not plain double division", () => {
    // seed0 = 0xFFFFFFFF is the discriminating row: plain double division gives
    // 0.9999999997671694 (!= 1), only the f32-rounded value matches the oracle.
    expect(seedNormalized(0xffffffff)).toBe(1);
    expect(0xffffffff / 2 ** 32).not.toBe(1);
  });
});

describe("seedSmall reproduces the game's map_seed_small", () => {
  it("matches every fixture row exactly (integer op, tolerance 0)", () => {
    for (const row of fixture.seeds) {
      expect(seedSmall(row.seed0), `seed0=${row.seed0}`).toBe(row.mapSeedSmall);
    }
  });

  it("only the parity matters downstream (vulcanus_starting_direction = -1 + 2*(seedSmall & 1))", () => {
    for (const row of fixture.seeds) {
      expect(seedSmall(row.seed0) & 1).toBe(row.mapSeedSmall & 1);
    }
  });

  it("is the 16 least significant bits (0 <= seedSmall < 65536)", () => {
    for (const row of fixture.seeds) {
      const v = seedSmall(row.seed0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(65536);
    }
  });
});
