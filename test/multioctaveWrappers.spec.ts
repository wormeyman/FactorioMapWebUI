import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-multioctave-wrappers.seed123456.json";
import { quickMultioctaveNoisePersistence } from "../src/noise/quickMultioctaveNoise";
import { amplitudeCorrectedMultioctaveNoise } from "../src/noise/variablePersistenceMultioctaveNoise";

interface QuickCase {
  octaves: number;
  inputScale: number;
  outputScale: number;
  oism: number;
  persistence: number;
  seed1: number;
  values: number[];
}
interface AcCase {
  octaves: number;
  inputScale: number;
  offsetX: number;
  persistence: number;
  amplitude: number;
  seed1: number;
  values: number[];
}

describe("the multioctave Lua wrappers reproduce the game", () => {
  // Ground truth: test/fixtures/oracle-multioctave-wrappers.seed123456.json.
  // Regenerate with `test/oracle/capture.ts multioctave-wrappers`.
  it("quick_multioctave_noise_persistence matches the game", () => {
    let worst = 0;
    for (const c of fixture.quick as QuickCase[]) {
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const got = quickMultioctaveNoisePersistence(p.x, p.y, {
          seed0: fixture.seed0,
          seed1: c.seed1,
          octaves: c.octaves,
          inputScale: c.inputScale,
          outputScale: c.outputScale,
          octaveInputScaleMultiplier: c.oism,
          persistence: c.persistence,
        });
        worst = Math.max(worst, Math.abs(got - c.values[i]));
      }
    }
    // Basis floor near-field, loosening to the f32 coordinate floor at the far
    // fixture points (see quick-multioctave-noise-NOTES.md).
    expect(worst).toBeLessThan(3e-3);
  });

  it("amplitude_corrected_multioctave_noise matches the game", () => {
    let worst = 0;
    for (const c of fixture.amplitudeCorrected as AcCase[]) {
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];
        const got = amplitudeCorrectedMultioctaveNoise(p.x, p.y, {
          seed0: fixture.seed0,
          seed1: c.seed1,
          octaves: c.octaves,
          inputScale: c.inputScale,
          offsetX: c.offsetX,
          persistence: c.persistence,
          amplitude: c.amplitude,
        });
        worst = Math.max(worst, Math.abs(got - c.values[i]));
      }
    }
    // 2^N gain amplifies the f32 coordinate floor at far points / large offset_x.
    expect(worst).toBeLessThan(5e-3);
  });
});
