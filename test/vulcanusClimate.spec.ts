import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-vulcanus-climate.seed123456.json";
import { withCtxDefaults } from "../src/noise/eval/ctx";
import { makeVulcanusClimate } from "../src/noise/expressions/vulcanusClimate";
import { makeVulcanusCracks } from "../src/noise/expressions/vulcanusCracks";
import { makeVulcanusHelpers } from "../src/noise/expressions/vulcanusHelpers";

describe("makeVulcanusClimate", () => {
  const ctx = withCtxDefaults({ seed0: fixture.seed0 });
  const helpers = makeVulcanusHelpers(ctx);
  const cracks = makeVulcanusCracks(ctx, helpers);
  const climate = makeVulcanusClimate(ctx, helpers, cracks);
  const positions = fixture.positions;

  // Each bound is the measured worst residual (rounded up with modest headroom, NOT
  // a uniform blanket bound), dominated by the deep-field point ((12345.75,
  // 6789.125)) - the same far-from-origin f32 coordinate floor documented across
  // the elevation/vulcanus specs. Measured worst: aux 4.62e-4, moisture 1.11e-4.
  const check = (fn: (x: number, y: number) => number, want: number[], bound: number): void => {
    let worst = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      worst = Math.max(worst, Math.abs(fn(p.x, p.y) - want[i]));
    }
    expect(worst).toBeLessThan(bound);
  };

  it("vulcanus_aux matches the oracle to the f32 floor", () => {
    check(climate.aux, fixture.aux, 6e-4);
  });

  it("vulcanus_moisture matches the oracle to the f32 floor", () => {
    check(climate.moisture, fixture.moisture, 2e-4);
  });
});
