import { describe, expect, it } from "vite-plus/test";
import { asymmetricRamps } from "../src/noise/trees/asymmetricRamps";

// core/prototypes/noise-functions.lua:114-124 -
//   min((input - from_top) / (from_top - from_bottom),
//       (to_top - input) / (to_bottom - to_top))
// The _tops are where the output crosses 0; the _bottoms are where it crosses -1.
// There is deliberately NO clamp - it is designed to sit inside a shared min().
describe("asymmetricRamps", () => {
  it("crosses 0 at from_top on the rising edge", () => {
    expect(asymmetricRamps(10, 0, 10, 14, 15)).toBe(0);
  });

  it("crosses 0 at to_top on the falling edge", () => {
    expect(asymmetricRamps(14, 0, 10, 14, 15)).toBe(0);
  });

  it("crosses -1 at from_bottom", () => {
    expect(asymmetricRamps(0, 0, 10, 14, 15)).toBe(-1);
  });

  it("crosses -1 at to_bottom", () => {
    expect(asymmetricRamps(15, 0, 10, 14, 15)).toBe(-1);
  });

  it("is positive between the tops, peaking midway", () => {
    expect(asymmetricRamps(12, 0, 10, 14, 15)).toBeCloseTo(0.2, 12);
  });

  it("keeps falling below -1 outside the bottoms (no clamp)", () => {
    expect(asymmetricRamps(-10, 0, 10, 14, 15)).toBe(-2);
  });

  it("takes the min of the two edges, not the max", () => {
    // Rising edge gives (20-10)/(10-0) = 1; falling gives (14-20)/(15-14) = -6.
    expect(asymmetricRamps(20, 0, 10, 14, 15)).toBe(-6);
  });

  it("can peak negative when the tops cross each other", () => {
    // from_top 16 > to_top 14: the ramps pass each other, so the max is negative.
    expect(asymmetricRamps(15, 15, 16, 14, 17)).toBe(-1);
  });
});
