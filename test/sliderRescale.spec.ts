import { describe, expect, it } from "vite-plus/test";
import { sliderRescale } from "../src/noise/eval/sliderRescale";

// Regression guard for the Step 1 extraction: these are the SAME three values
// test/rockCatalog.spec.ts already asserted against the pre-extraction inline
// rocks implementation. Moving the function to src/noise/eval/sliderRescale.ts
// must not change any of them.
describe("sliderRescale (extracted from the rocks module)", () => {
  it("maps the default slider value 1 to exactly 1, for any exponent", () => {
    expect(sliderRescale(1, 1.5)).toBe(1);
  });
  it("maps the endpoints of the 1/6..6 slider range to 1/n..n", () => {
    expect(sliderRescale(6, 1.5)).toBeCloseTo(1.5, 6);
    expect(sliderRescale(1 / 6, 1.5)).toBeCloseTo(1 / 1.5, 6);
  });
});
