import { describe, expect, it } from "vite-plus/test";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import {
  basementValue,
  regularBlobAmplitudeAt,
  regularBlobAmplitudeMaximumDistance,
  regularDensityAt,
  regularSpotHeightTypicalAt,
  regularSpotQuantityBaseAt,
  startingBlobAmplitude,
} from "../src/noise/resources/resourceMath";

const iron = RESOURCE_CATALOG[0];
const uranium = RESOURCE_CATALOG.find((r) => r.name === "uranium-ore")!;
const one = { frequency: 1, size: 1 };

describe("resourceMath", () => {
  it("regular density is zero inside the fade-in radius and ramps outside it", () => {
    // fade-in = clamp((d-120)/300); at d<=120 it's 0, so no regular patches near spawn.
    expect(regularDensityAt(0, iron, one)).toBe(0);
    expect(regularDensityAt(120, iron, one)).toBe(0);
    // d=500: fade-in clamps to 1; double-up = 1 + (500-300)/1300 = 1.153846...
    expect(regularDensityAt(500, iron, one)).toBeCloseTo(10 * (1 + 200 / 1300), 9);
    // uranium (has_starting=false, sign 0, not -1) uses the SAME fade-in branch.
    expect(regularDensityAt(0, uranium, one)).toBe(0);
  });

  it("double-density ramp caps at 2x by regular_blob_amplitude_maximum_distance", () => {
    // d=2000: fade-in 1, size_effective=1700 -> clamp(1700/1300)=1 -> double-up = 2.
    expect(regularDensityAt(2000, iron, one)).toBe(20);
    expect(regularBlobAmplitudeMaximumDistance(iron)).toBe(1600); // 1300 + 300
  });

  it("spot quantity base is 1e6 / base_spots_per_km2 / frequency times density", () => {
    const d = 500;
    expect(regularSpotQuantityBaseAt(d, iron, one)).toBeCloseTo(
      (1000000 / 2.5) * regularDensityAt(d, iron, one),
      3,
    );
  });

  it("spot height typical is cbrt(meanSize*quantityBase) / (pi/3 * rq^2)", () => {
    const d = 800;
    const meanSize = (iron.randomSpotSizeMin + iron.randomSpotSizeMax) / 2;
    const expected =
      Math.cbrt(meanSize * regularSpotQuantityBaseAt(d, iron, one)) /
      ((Math.PI / 3) * iron.regularRqFactor ** 2);
    expect(regularSpotHeightTypicalAt(d, iron, one)).toBeCloseTo(expected, 6);
  });

  it("basement_value is -6 * max(regular blob amp at max distance, starting blob amp)", () => {
    const regular = regularBlobAmplitudeAt(regularBlobAmplitudeMaximumDistance(iron), iron, one);
    const starting = startingBlobAmplitude(iron, one);
    expect(basementValue(iron, one)).toBeCloseTo(-6 * Math.max(regular, starting), 6);
    expect(basementValue(iron, one)).toBeLessThan(0);
    // For iron the regular blob amplitude (~2052) dominates the starting one (~241).
    expect(regular).toBeGreaterThan(starting);
  });

  it("scales density with frequency and size controls", () => {
    const base = regularDensityAt(500, iron, one);
    expect(regularDensityAt(500, iron, { frequency: 1, size: 2 })).toBeCloseTo(base * 2, 6);
    // frequency enters density linearly, but also divides quantity base -> quantity base
    // is frequency-independent in the density*1/frequency product? No: density has *frequency,
    // quantityBase divides by frequency, so quantityBase's frequency factors cancel.
    const qb1 = regularSpotQuantityBaseAt(500, iron, { frequency: 1, size: 1 });
    const qb2 = regularSpotQuantityBaseAt(500, iron, { frequency: 3, size: 1 });
    expect(qb2).toBeCloseTo(qb1, 3);
  });
});
