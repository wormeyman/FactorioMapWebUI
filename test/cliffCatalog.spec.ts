import { describe, expect, it } from "vite-plus/test";
import {
  CLIFF_MAP_COLOR,
  getModifiedElevationInterval,
  getModifiedRichness,
  sliderToLinear,
} from "../src/noise/cliffs/cliffCatalog";

describe("cliff catalog math", () => {
  // slider_to_linear(1) = midpoint; (6) = hi; (1/6) = lo (log2(6)/log2(6)=1, log2(1/6)/log2(6)=-1)
  it("sliderToLinear anchors", () => {
    expect(sliderToLinear(1, -1, 1)).toBeCloseTo(0, 12);
    expect(sliderToLinear(6, -1, 1)).toBeCloseTo(1, 12);
    expect(sliderToLinear(1 / 6, -1, 1)).toBeCloseTo(-1, 12);
    expect(sliderToLinear(1, -1.7, 1.7)).toBeCloseTo(0, 12);
  });
  // interval = base/frequency; richness = base*continuity; both identity at slider 1
  it("lever modifiers", () => {
    expect(getModifiedElevationInterval(40, 1)).toBeCloseTo(40, 12);
    expect(getModifiedElevationInterval(40, 2)).toBeCloseTo(20, 12); // higher freq -> tighter bands
    expect(getModifiedRichness(1, 1)).toBeCloseTo(1, 12);
    expect(getModifiedRichness(1, 0)).toBe(0); // continuity 0 -> cliff_richness 0 (cliffs disabled)
  });
  it("map color drift guard", () => expect([...CLIFF_MAP_COLOR]).toEqual([144, 119, 87]));
});
