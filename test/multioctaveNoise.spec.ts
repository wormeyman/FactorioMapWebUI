import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-multioctave.seed123456.json";
import {
  fastLog2,
  fastPow2,
  makeMultioctaveNoise,
  multioctaveNoise,
  type MultioctaveParams,
} from "../src/noise/multioctaveNoise";

describe("fastapprox helpers reproduce Factorio's Math::log2 / Math::exp2f", () => {
  it("fastPow2(fastLog2(x)) round-trips within the fastapprox floor", () => {
    for (const x of [0.1, 0.5, 1, 2, 3.7, 10, 100]) {
      const got = fastPow2(fastLog2(x));
      expect(Math.abs(got - x) / x).toBeLessThan(0.02);
    }
  });
});

describe("multioctaveNoise reproduces the game", () => {
  // Ground truth: test/fixtures/oracle-multioctave.seed123456.json, captured via
  // the oracle harness. Regenerate with test/oracle/capture.ts.
  it("matches multioctave_noise across octaves / persistence / scales / seeds", () => {
    // Two domains. Within a realistic preview window the match is ~3e-5; at
    // extreme coordinates it loosens to ~1e-4. The residual is the game's f32
    // pipeline: the per-octave x offset pushes each octave's coordinate large, and
    // the game rounds it to f32 before sampling basis while we evaluate in f64 - a
    // divergence that grows with |coordinate|. This is the fastapprox/f32 floor the
    // roadmap treats as invisible, not a modelling error (power-of-two persistence
    // like 0.5, where the normalization is exact, sits near the basis floor).
    let worstNear = 0;
    let worstNearLabel = "";
    let worstFar = 0;
    for (const c of fixture.cases) {
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const got = multioctaveNoise(p.x, p.y, {
          seed0: fixture.seed0,
          seed1: c.seed1,
          octaves: c.octaves,
          persistence: c.persistence,
          inputScale: c.inputScale,
          outputScale: c.outputScale,
        });
        const err = Math.abs(got - c.values[i]);
        if (Math.abs(p.x) < 3000 && Math.abs(p.y) < 3000) {
          if (err > worstNear) {
            worstNear = err;
            worstNearLabel = `octaves=${c.octaves} p=${c.persistence} seed1=${c.seed1} @(${p.x},${p.y})`;
          }
        } else {
          worstFar = Math.max(worstFar, err);
        }
      }
    }
    expect(worstNear, `worst near-field at ${worstNearLabel}`).toBeLessThan(5e-5);
    expect(worstFar, "worst far-field").toBeLessThan(2e-4);
  });
});

describe("makeMultioctaveNoise (hoisted) matches multioctaveNoise exactly", () => {
  const CONFIGS: MultioctaveParams[] = [
    {
      seed0: 123456,
      seed1: 700,
      octaves: 4,
      persistence: 0.5,
      inputScale: 1 / 150,
      outputScale: 1,
    },
    { seed0: 123456, seed1: 900, octaves: 4, persistence: 0.5, inputScale: 1 / 90, outputScale: 1 },
    {
      seed0: 123456,
      seed1: 1000,
      octaves: 2,
      persistence: 0.6,
      inputScale: 1 / 1600,
      outputScale: 1,
    },
    {
      seed0: 123456,
      seed1: 1100,
      octaves: 1,
      persistence: 0.6,
      inputScale: 1 / 1600,
      outputScale: 1,
    },
    { seed0: 42, seed1: 3, octaves: 6, persistence: 0.75, inputScale: 0.2, outputScale: 0.5 },
  ];
  it("is identical across a grid for every config", () => {
    for (const cfg of CONFIGS) {
      const made = makeMultioctaveNoise(cfg);
      for (let gx = -2; gx <= 2; gx++) {
        for (let gy = -2; gy <= 2; gy++) {
          const x = gx * 37 + 0.5;
          const y = gy * 41 + 0.25;
          expect(made(x, y)).toBe(multioctaveNoise(x, y, cfg));
        }
      }
    }
  });
});
