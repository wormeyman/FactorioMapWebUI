import { describe, expect, it } from "vite-plus/test";
import basisFixture from "../fixtures/basis-noise.seed123456.json";
import type { BasisNoiseTables } from "../../src/noise/basisNoise";
import { basisNoiseExpr } from "../../src/noise/eval/primitives";

const tables: BasisNoiseTables = {
  sigma: basisFixture.sigma,
  a: basisFixture.a,
  b: basisFixture.b,
};

describe("eval/primitives basisNoiseExpr", () => {
  it("reproduces the game's basis_noise with input/output scale (output_scale=1)", () => {
    let worst = 0;
    for (const p of basisFixture.points) {
      const got = basisNoiseExpr(
        p.x,
        p.y,
        {
          seed0: basisFixture.seed,
          seed1: 0,
          inputScale: basisFixture.inputScale,
          outputScale: 1,
        },
        tables,
      );
      worst = Math.max(worst, Math.abs(got - p.v));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("scales linearly with output_scale", () => {
    const base = basisNoiseExpr(3.5, -2.25, {
      seed0: 1,
      seed1: 123,
      inputScale: 1 / 8,
      outputScale: 1,
    });
    const scaled = basisNoiseExpr(3.5, -2.25, {
      seed0: 1,
      seed1: 123,
      inputScale: 1 / 8,
      outputScale: 1.5,
    });
    expect(scaled).toBeCloseTo(base * 1.5, 12);
  });

  it("applies offset_x before input_scale", () => {
    const withOffset = basisNoiseExpr(0, 1.5, {
      seed0: 1,
      seed1: 123,
      inputScale: 1 / 8,
      outputScale: 1,
      offsetX: 16,
    });
    const shifted = basisNoiseExpr(16, 1.5, {
      seed0: 1,
      seed1: 123,
      inputScale: 1 / 8,
      outputScale: 1,
    });
    expect(withOffset).toBeCloseTo(shifted, 12);
  });
});
