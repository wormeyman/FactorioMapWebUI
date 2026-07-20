import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-expression-in-range.seed123456.json";
import { expressionInRange } from "../src/noise/tiles/expressionInRange";

// Ground truth: test/fixtures/oracle-expression-in-range.seed123456.json, captured
// via the oracle harness (test/oracle/capture.ts expression-in-range). The native
// builtin's peak/falloff math, RE'd from these sweeps - see
// docs/noise/expression-in-range-NOTES.md for the derivation.
//
// Derived formula:
//   m = min over all dims i of min(value_i - from_i, to_i - value_i)
//   result = min(peak_maximum, peak_multiplier * m)
// (no lower clamp; peak_maximum may be Infinity.)
//
// The observed worst residual over every sweep is ~9.5e-7 (pure f32 noise), well
// under the 8e-3 elevation f32 floor.
const FLOOR = 8e-3;

describe("expressionInRange reproduces the native builtin", () => {
  it("matches the bounded 1-D sweep (pm=20, pmax=1) to the f32 floor", () => {
    const s = fixture.sweeps.oneD_20_1;
    let worst = 0;
    for (let i = 0; i < s.positions.length; i++) {
      const p = s.positions[i];
      const got = expressionInRange(20, 1, [p.x / 1000], [-0.5], [0.5]);
      worst = Math.max(worst, Math.abs(got - s.values[i]));
    }
    expect(worst, "worst bounded 1-D residual").toBeLessThan(FLOOR);
  });

  it("matches the unbounded 1-D sweep (pm=5, pmax=inf) and does NOT clamp in range", () => {
    const s = fixture.sweeps.oneD_5_inf;
    let worst = 0;
    let maxInRange = -Infinity;
    for (let i = 0; i < s.positions.length; i++) {
      const p = s.positions[i];
      const expr = p.x / 1000;
      const got = expressionInRange(5, Infinity, [expr], [-0.5], [0.5]);
      worst = Math.max(worst, Math.abs(got - s.values[i]));
      if (expr >= -0.5 && expr <= 0.5) maxInRange = Math.max(maxInRange, got);
    }
    expect(worst, "worst unbounded 1-D residual").toBeLessThan(FLOOR);
    // The whole point of pmax=inf: in-range values exceed 1 (peak ~2.5 at center).
    // A hard clamp to 1 would silently kill sand-1's coastal boost.
    expect(maxInRange, "in-range peak must exceed 1 (no clamp)").toBeGreaterThan(1);
  });

  it("matches the 2-D sweep with the min combination rule (pm=20, pmax=1)", () => {
    const s = fixture.sweeps.twoD;
    let worst = 0;
    for (let i = 0; i < s.positions.length; i++) {
      const p = s.positions[i];
      const got = expressionInRange(20, 1, [p.x / 1000, p.y / 1000], [-0.5, -0.5], [0.5, 0.5]);
      worst = Math.max(worst, Math.abs(got - s.values[i]));
    }
    expect(worst, "worst 2-D residual").toBeLessThan(FLOOR);
  });
});
