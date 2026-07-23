import { describe, expect, it } from "vite-plus/test";
import { rangeSelectBase, sliderRescale, ROCK_MAP_COLOR } from "../src/noise/rocks/rockCatalog";

describe("rangeSelectBase", () => {
  // range_select_base(input, from, to, slope, min, max) =
  //   clamp(min(input - from, to - input)/slope, min, max)
  it("is 0 exactly at the from and to markers", () => {
    expect(rangeSelectBase(0.35, 0.35, 1, 0.2, -10, 0)).toBeCloseTo(0, 12);
    expect(rangeSelectBase(1, 0.35, 1, 0.2, -10, 0)).toBeCloseTo(0, 12);
  });
  it("descends below the range when min < 0 (rocks use min=-10)", () => {
    // input 0.15 is 0.2 below `from`; (0.15-0.35)/0.2 = -1, clamped within [-10,0]
    expect(rangeSelectBase(0.15, 0.35, 1, 0.2, -10, 0)).toBeCloseTo(-1, 12);
  });
  it("clamps at the max ceiling inside the range", () => {
    // deep inside 0.35..1 the raw value exceeds max=0, so it clamps to 0
    expect(rangeSelectBase(0.7, 0.35, 1, 0.2, -10, 0)).toBe(0);
  });
});

describe("sliderRescale", () => {
  it("maps the default slider value 1 to exactly 1", () => {
    expect(sliderRescale(1, 1.5)).toBe(1);
  });
  it("maps the endpoints of the 1/6..6 slider range to 1/n..n", () => {
    expect(sliderRescale(6, 1.5)).toBeCloseTo(1.5, 6);
    expect(sliderRescale(1 / 6, 1.5)).toBeCloseTo(1 / 1.5, 6);
  });
});

describe("ROCK_MAP_COLOR", () => {
  it("is the game's charted rock color", () => {
    expect([...ROCK_MAP_COLOR]).toEqual([129, 105, 78]);
  });
});
