import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-variable-persistence-multioctave.seed123456.json";
import {
  makeVariablePersistenceMultioctaveNoise,
  variablePersistenceMultioctaveNoise,
} from "../src/noise/variablePersistenceMultioctaveNoise";

interface VarPersCase {
  octaves: number;
  inputScale: number;
  outputScale: number;
  offsetX: number;
  seed1: number;
  values: number[];
}

function paramsFor(seed0: number, c: VarPersCase) {
  return {
    seed0,
    seed1: c.seed1,
    octaves: c.octaves,
    inputScale: c.inputScale,
    outputScale: c.outputScale,
    offsetX: c.offsetX,
  };
}

/**
 * The largest absolute noise-space x-coordinate any octave samples, i.e.
 * max_k |(x + offset_x)*input_scale*0.5^(k+1) + k*(-7936)|. Beyond a few hundred
 * noise units the game's f32 coordinate pipeline diverges from our f64 (the
 * documented f32 floor) - the coarse octaves' fixed per-octave shift and a large
 * offset_x both push into that regime.
 */
function maxNoiseX(c: VarPersCase, x: number): number {
  let m = 0;
  let scale = c.inputScale * 0.5;
  for (let k = 0; k < c.octaves; k++) {
    m = Math.max(m, Math.abs((x + c.offsetX) * scale + k * -7936));
    scale *= 0.5;
  }
  return m;
}

describe("variablePersistenceMultioctaveNoise reproduces the game", () => {
  // Ground truth: test/fixtures/oracle-variable-persistence-multioctave.seed123456.json,
  // captured via the oracle harness. `persistenceField` is the per-tile value of the
  // persistence expression (routed onto elevation), fed back in as the model's
  // per-tile p. Regenerate with test/oracle/capture.ts.
  it("matches variable_persistence_multioctave_noise across octaves / scales / offset / seeds", () => {
    let worstNear = 0;
    let worstNearLabel = "";
    let worstFar = 0;
    for (const c of fixture.cases as VarPersCase[]) {
      const params = paramsFor(fixture.seed0, c);
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const persistence = fixture.persistenceField[i];
        const got = variablePersistenceMultioctaveNoise(p.x, p.y, persistence, params);
        const err = Math.abs(got - c.values[i]);
        if (maxNoiseX(c, p.x) < 500) {
          if (err > worstNear) {
            worstNear = err;
            worstNearLabel = `octaves=${c.octaves} offset=${c.offsetX} seed1=${c.seed1} @(${p.x},${p.y})`;
          }
        } else {
          worstFar = Math.max(worstFar, err);
        }
      }
    }
    // Near-field sits at the basis floor; far-field is the same f32 coordinate floor
    // the plain/quick multioctave ops document, reached here by the coarse octaves'
    // k*(-7936) shift and the large climate-scale offset_x (40000) times the 2^N gain.
    expect(worstNear, `worst near-field at ${worstNearLabel}`).toBeLessThan(5e-5);
    expect(worstFar, "worst far-field").toBeLessThan(5e-3);
  });

  it("makeVariablePersistenceMultioctaveNoise (prebuilt tables) agrees with the direct form", () => {
    for (const c of fixture.cases as VarPersCase[]) {
      const params = paramsFor(fixture.seed0, c);
      const fn = makeVariablePersistenceMultioctaveNoise(params);
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const persistence = fixture.persistenceField[i];
        expect(fn(p.x, p.y, persistence)).toBe(
          variablePersistenceMultioctaveNoise(p.x, p.y, persistence, params),
        );
      }
    }
  });
});
