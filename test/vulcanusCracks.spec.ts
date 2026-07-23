import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-vulcanus-cracks.seed123456.json";
import { withCtxDefaults } from "../src/noise/eval/ctx";
import { makeVulcanusCracks } from "../src/noise/expressions/vulcanusCracks";
import { makeVulcanusHelpers } from "../src/noise/expressions/vulcanusHelpers";

describe("makeVulcanusCracks", () => {
  const ctx = withCtxDefaults({ seed0: fixture.seed0 });
  const helpers = makeVulcanusHelpers(ctx);
  const cracks = makeVulcanusCracks(ctx, helpers);
  const positions = fixture.positions;

  // Each bound is the measured worst residual (rounded up with modest headroom),
  // dominated by the deep-field point (index 60, (12345.75, 6789.125)) - the same
  // far-from-origin f32 coordinate floor documented across the elevation/vulcanus
  // specs. Near-grid residuals are far tighter.
  const check = (name: keyof typeof cracks, want: number[], bound: number): void => {
    let worst = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const got = (cracks[name] as (x: number, y: number) => number)(p.x, p.y);
      worst = Math.max(worst, Math.abs(got - want[i]));
    }
    expect(worst).toBeLessThan(bound);
  };

  it("vulcanus_hairline_cracks matches the oracle to the f32 floor", () => {
    check("hairlineCracks", fixture.hairlineCracks, 4e-3);
  });

  it("vulcanus_flood_cracks_a matches the oracle to the f32 floor", () => {
    check("floodCracksA", fixture.floodCracksA, 4e-3);
  });

  it("vulcanus_flood_cracks_b matches the oracle to the f32 floor", () => {
    check("floodCracksB", fixture.floodCracksB, 4e-3);
  });

  it("vulcanus_flood_paths matches the oracle to the f32 floor", () => {
    check("floodPaths", fixture.floodPaths, 4e-3);
  });

  it("vulcanus_flood_basalts_func matches the oracle to the f32 floor", () => {
    check("floodBasaltsFunc", fixture.floodBasaltsFunc, 4e-3);
  });
});
