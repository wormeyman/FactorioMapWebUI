import { describe, expect, it } from "vite-plus/test";
import { withCtxDefaults } from "../../src/noise/eval/ctx";

describe("eval/ctx", () => {
  it("fills the far-from-spawn defaults", () => {
    const ctx = withCtxDefaults({ seed0: 123456, x: 3, y: 4 });
    expect(ctx.waterLevel).toBe(0);
    expect(ctx.segmentationMultiplier).toBe(1);
    expect(ctx.startingPositions).toEqual([{ x: 0, y: 0 }]);
    // Lake positions are no longer forced to []; makeElevationLakes computes the
    // real ones when unset (single owner of the default). Unset => undefined here.
    expect(ctx.startingLakePositions).toBeUndefined();
    expect(ctx.x).toBe(3);
    expect(ctx.y).toBe(4);
    expect(ctx.seed0).toBe(123456);
  });

  it("lets callers override any default", () => {
    const ctx = withCtxDefaults({
      seed0: 1,
      x: 0,
      y: 0,
      segmentationMultiplier: 0.25,
      startingLakePositions: [{ x: 10, y: 10 }],
    });
    expect(ctx.segmentationMultiplier).toBe(0.25);
    expect(ctx.startingLakePositions).toEqual([{ x: 10, y: 10 }]);
    // untouched defaults still apply
    expect(ctx.startingPositions).toEqual([{ x: 0, y: 0 }]);
  });
});
