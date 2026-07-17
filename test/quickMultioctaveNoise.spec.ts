import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-quick-multioctave.seed123456.json";
import {
  makeQuickMultioctaveNoise,
  quickMultioctaveNoise,
} from "../src/noise/quickMultioctaveNoise";

interface QuickCase {
  octaves: number;
  inputScale: number;
  outputScale: number;
  oosm: number;
  oism: number;
  offsetX: number;
  seed1: number;
  values: number[];
}

function paramsFor(seed0: number, c: QuickCase) {
  return {
    seed0,
    seed1: c.seed1,
    octaves: c.octaves,
    inputScale: c.inputScale,
    outputScale: c.outputScale,
    octaveOutputScaleMultiplier: c.oosm,
    octaveInputScaleMultiplier: c.oism,
    offsetX: c.offsetX,
  };
}

describe("quickMultioctaveNoise reproduces the game", () => {
  // Ground truth: test/fixtures/oracle-quick-multioctave.seed123456.json, captured
  // via the oracle harness. Regenerate with test/oracle/capture.ts.
  it("matches quick_multioctave_noise across octaves / multipliers / offset / seeds", () => {
    // Two domains, split by the octave-0 sampled coordinate |(x + offset_x)*IS|.
    // Where that is small the match is the basis floor (~1e-6). A large offset_x (the
    // climate-tree values, e.g. 40000) or a far world point pushes the sampled
    // coordinate to hundreds/thousands of noise units, where the game's f32 coordinate
    // pipeline diverges from our f64 - the documented f32 floor (basis-noise-NOTES.md),
    // invisible in a downsampled preview.
    let worstNear = 0;
    let worstNearLabel = "";
    let worstFar = 0;
    for (const c of fixture.cases as QuickCase[]) {
      const params = paramsFor(fixture.seed0, c);
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const got = quickMultioctaveNoise(p.x, p.y, params);
        const err = Math.abs(got - c.values[i]);
        const noiseX = Math.abs((p.x + c.offsetX) * c.inputScale);
        if (noiseX < 500) {
          if (err > worstNear) {
            worstNear = err;
            worstNearLabel = `octaves=${c.octaves} offset=${c.offsetX} seed1=${c.seed1} @(${p.x},${p.y})`;
          }
        } else {
          worstFar = Math.max(worstFar, err);
        }
      }
    }
    // 5e-5 near / 3e-3 far: the same f32 pipeline floor the plain multioctave op sits
    // at (multioctave-noise-NOTES.md), reached here by 6-octave accumulation at
    // moderately-far points and by large-offset_x sampled coordinates respectively.
    expect(worstNear, `worst near-field at ${worstNearLabel}`).toBeLessThan(5e-5);
    expect(worstFar, "worst far-field").toBeLessThan(3e-3);
  });

  it("makeQuickMultioctaveNoise (prebuilt tables) agrees with the direct form", () => {
    for (const c of fixture.cases as QuickCase[]) {
      const params = paramsFor(fixture.seed0, c);
      const fn = makeQuickMultioctaveNoise(params);
      for (const p of fixture.positions) {
        expect(fn(p.x, p.y)).toBe(quickMultioctaveNoise(p.x, p.y, params));
      }
    }
  });
});
