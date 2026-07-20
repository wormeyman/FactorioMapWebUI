import { describe, expect, it } from "vite-plus/test";
import { clamp, lerp, max, min, log2, sliderToLinear } from "../../src/noise/eval/math";

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

  it("sliderToLinear: s=1 is the midpoint, s=6 is hi", () => {
    expect(sliderToLinear(1, -0.5, 0.5)).toBeCloseTo(0, 12);
    expect(sliderToLinear(6, -0.5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it("sliderToLinear: s -> 0 approaches lo (log2(s) -> -inf)", () => {
    expect(sliderToLinear(1 / 64, -0.5, 0.5)).toBeLessThan(-0.5);
  });

  it("sliderToLinear scales with an arbitrary [lo, hi]", () => {
    expect(sliderToLinear(1, 0, 10)).toBeCloseTo(5, 12);
    expect(sliderToLinear(6, 0, 10)).toBeCloseTo(10, 12);
  });
});
