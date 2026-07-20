import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-temperature.seed123456.json";
import { makeTemperature } from "../src/noise/expressions/temperature";

describe("makeTemperature reproduces the game's temperature (temperature_basic) tree", () => {
  const evalAt = makeTemperature({ seed0: fixture.seed0 });

  it("matches the numeric temperature to the f32 coordinate floor", () => {
    let worst = 0;
    let worstLabel = "";
    for (let i = 0; i < fixture.positions.length; i++) {
      const p = fixture.positions[i];
      const err = Math.abs(evalAt(p.x, p.y) - fixture.temperature[i]);
      if (err > worst) {
        worst = err;
        worstLabel = `@(${p.x},${p.y})`;
      }
    }
    // Starting floor for this milestone is 8e-3 (the elevation f32-coordinate
    // floor), but temperature's output_scale of 1/20 shrinks any f32 divergence
    // by the same factor, so the observed worst here (~7.07e-5) is far tighter.
    // Calibrated just above that observed worst - never loosen this without a
    // new observed-worst measurement to justify it.
    expect(worst, `worst ${worstLabel}`).toBeLessThan(1e-4);
  });
});

describe("makeTemperature bias and frequency parameters", () => {
  const GRID: Array<[number, number]> = [
    [0.5, 0.25],
    [2200.5, 0.25],
    [-1600.5, 1200.25],
    [12345.75, 6789.125],
  ];

  it("defaults bias to 0 (omitted === explicit 0)", () => {
    const def = makeTemperature({ seed0: 123456 });
    const explicit = makeTemperature({ seed0: 123456, bias: 0 });
    for (const [x, y] of GRID) expect(def(x, y)).toBe(explicit(x, y));
  });

  it("shifts the result by exactly the bias, until clamped", () => {
    const def = makeTemperature({ seed0: 123456 });
    const biased = makeTemperature({ seed0: 123456, bias: 5 });
    for (const [x, y] of GRID) {
      expect(biased(x, y)).toBeCloseTo(Math.min(def(x, y) + 5, 50), 9);
    }
  });

  it("defaults frequency to 1 (omitted === explicit 1)", () => {
    const def = makeTemperature({ seed0: 123456 });
    const explicit = makeTemperature({ seed0: 123456, frequency: 1 });
    for (const [x, y] of GRID) expect(def(x, y)).toBe(explicit(x, y));
  });

  it("stays within the [-20, 50] clamp bounds", () => {
    const evalAt = makeTemperature({ seed0: 123456, bias: 1000 });
    for (const [x, y] of GRID) {
      expect(evalAt(x, y)).toBeLessThanOrEqual(50);
      expect(evalAt(x, y)).toBeGreaterThanOrEqual(-20);
    }
    const evalLow = makeTemperature({ seed0: 123456, bias: -1000 });
    for (const [x, y] of GRID) {
      expect(evalLow(x, y)).toBeGreaterThanOrEqual(-20);
    }
  });
});
