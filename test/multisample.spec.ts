import { describe, expect, it } from "vite-plus/test";

import fixture from "./fixtures/oracle-multisample.seed123456.json";
import { multisample } from "../src/noise/eval/multisample";

// Ground truth: test/fixtures/oracle-multisample.seed123456.json, captured via
// the oracle harness (test/oracle/capture.ts multisample). The native builtin's
// offset rule, RE'd from these sweeps - see docs/noise/vulcanus-multisample-NOTES.md
// for the derivation.
//
// Derived rule: multisample(expression, dx, dy) at (x, y) == expression
// evaluated at (x + dx, y + dy) - a plain integer coordinate shift, not a
// half-tile supersample. Observed worst residual over all 150 comparisons
// (15 offsets x 5 points x 2 axes) is exactly 0 - not merely under the f32
// floor, bit-for-bit exact - so this spec asserts exact equality.

describe("multisample reproduces the native builtin's coordinate shift", () => {
  it("matches every captured (dx, dy) offset for both the x and y inner expressions", () => {
    for (const c of fixture.cases) {
      for (let i = 0; i < fixture.positions.length; i++) {
        const p = fixture.positions[i];

        const gotX = multisample((xx, _yy) => xx, p.x, p.y, c.dx, c.dy);
        expect(gotX, `x at (${p.x},${p.y}) dx=${c.dx} dy=${c.dy}`).toBe(c.sampledX[i]);

        const gotY = multisample((_xx, yy) => yy, p.x, p.y, c.dx, c.dy);
        expect(gotY, `y at (${p.x},${p.y}) dx=${c.dx} dy=${c.dy}`).toBe(c.sampledY[i]);
      }
    }
  });

  it("has no cross term: dx alone never moves the sampled y, dy alone never moves the sampled x", () => {
    const p = fixture.positions[0];
    const zero = fixture.cases.find((c) => c.dx === 0 && c.dy === 0);
    if (!zero) throw new Error("fixture missing the (0,0) baseline case");
    const dxOnly = fixture.cases.find((c) => c.dx === 2 && c.dy === 0);
    if (!dxOnly) throw new Error("fixture missing a dx-only case");
    const dyOnly = fixture.cases.find((c) => c.dx === 0 && c.dy === 2);
    if (!dyOnly) throw new Error("fixture missing a dy-only case");

    expect(dxOnly.sampledY[0]).toBe(zero.sampledY[0]);
    expect(dyOnly.sampledX[0]).toBe(zero.sampledX[0]);
    expect(p.x).not.toBe(dxOnly.sampledX[0]); // sanity: dx DID move x
  });

  it("directly exercises the interface with a real inner expression (not just identity)", () => {
    // sampleAt = a linear combination that would reveal a bug in argument order.
    const sampleAt = (x: number, y: number): number => 1000 * x + y;
    const p = fixture.positions[3]; // (100.125, -300.875)
    const got = multisample(sampleAt, p.x, p.y, 2, -1);
    expect(got).toBe(1000 * (p.x + 2) + (p.y - 1));
  });
});
