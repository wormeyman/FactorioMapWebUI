import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-aux.seed123456.json";
import { makeAux } from "../src/noise/expressions/aux";

describe("makeAux reproduces the game's aux (aux_nauvis) tree", () => {
  const evalAt = makeAux({ seed0: fixture.seed0 });

  it("matches the numeric aux to the f32 coordinate floor", () => {
    let worst = 0;
    let worstLabel = "";
    for (let i = 0; i < fixture.positions.length; i++) {
      const p = fixture.positions[i];
      const err = Math.abs(evalAt(p.x, p.y) - fixture.aux[i]);
      if (err > worst) {
        worst = err;
        worstLabel = `@(${p.x},${p.y})`;
      }
    }
    // Starting floor for this milestone is 8e-3 (the elevation f32-coordinate
    // floor), but aux's noise term has output_scale 0.25 and the whole result
    // is clamped to [0,1], so any f32 divergence is shrunk well below that.
    // Observed worst here is ~1.01e-5 (@(-2332.95, -2333.20), the deep-field
    // far ring); calibrated just above it - never loosen this without a new
    // observed-worst measurement to justify it.
    expect(worst, `worst ${worstLabel}`).toBeLessThan(2e-5);
  });
});

describe("makeAux bias and frequency parameters", () => {
  const GRID: Array<[number, number]> = [
    [0.5, 0.25],
    [2200.5, 0.25],
    [-1600.5, 1200.25],
    [12345.75, 6789.125],
  ];

  it("defaults bias to 0 (omitted === explicit 0)", () => {
    const def = makeAux({ seed0: 123456 });
    const explicit = makeAux({ seed0: 123456, bias: 0 });
    for (const [x, y] of GRID) expect(def(x, y)).toBe(explicit(x, y));
  });

  it("shifts the result by exactly the bias, until clamped", () => {
    const def = makeAux({ seed0: 123456 });
    const biased = makeAux({ seed0: 123456, bias: 0.1 });
    for (const [x, y] of GRID) {
      expect(biased(x, y)).toBeCloseTo(Math.min(def(x, y) + 0.1, 1), 9);
    }
  });

  it("defaults frequency to 1 (omitted === explicit 1)", () => {
    const def = makeAux({ seed0: 123456 });
    const explicit = makeAux({ seed0: 123456, frequency: 1 });
    for (const [x, y] of GRID) expect(def(x, y)).toBe(explicit(x, y));
  });

  it("defaults segmentationMultiplier to 1 (omitted === explicit 1)", () => {
    const def = makeAux({ seed0: 123456 });
    const explicit = makeAux({ seed0: 123456, segmentationMultiplier: 1 });
    for (const [x, y] of GRID) expect(def(x, y)).toBe(explicit(x, y));
  });

  it("stays within the [0, 1] clamp bounds", () => {
    const evalHigh = makeAux({ seed0: 123456, bias: 1000 });
    for (const [x, y] of GRID) {
      expect(evalHigh(x, y)).toBeLessThanOrEqual(1);
      expect(evalHigh(x, y)).toBeGreaterThanOrEqual(0);
    }
    const evalLow = makeAux({ seed0: 123456, bias: -1000 });
    for (const [x, y] of GRID) {
      expect(evalLow(x, y)).toBeGreaterThanOrEqual(0);
    }
  });
});
