import { describe, expect, it } from "vite-plus/test";
import { clamp, lerp, max, min, log2 } from "../../src/noise/eval/math";

describe("eval/math", () => {
  it("clamps into [lo, hi]", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });

  it("lerps endpoints and midpoint", () => {
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 1)).toBe(4);
    expect(lerp(2, 4, 0.5)).toBe(3);
  });

  it("min/max take varargs", () => {
    expect(min(3, 1, 2)).toBe(1);
    expect(max(3, 1, 2)).toBe(3);
    expect(min(-1)).toBe(-1);
  });

  it("log2 matches Math.log2 (default size => 0)", () => {
    expect(log2(1)).toBe(0);
    expect(log2(8)).toBeCloseTo(3, 12);
    expect(log2(0.5)).toBeCloseTo(-1, 12);
  });
});
