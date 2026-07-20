import { describe, expect, it } from "vite-plus/test";
import { fastCbrt } from "../src/noise/fastApprox";
import { RESOURCE_CATALOG } from "../src/noise/resources/resourceCatalog";
import {
  basementValue,
  regularBlobAmplitudeAt,
  regularBlobAmplitudeMaximumDistance,
  regularDensityAt,
  regularSpotHeightTypicalAt,
  regularSpotQuantityBaseAt,
  startingAmount,
  startingAreaSpotQuantity,
  startingBlobAmplitude,
  startingDensityAt,
  startingFavorabilityBaseAt,
  startingModulation,
  startingSpotRadius,
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

  it("spot height typical is fastCbrt(meanSize*quantityBase) / (pi/3 * rq^2)", () => {
    // The game's noise machine takes this cube root through its fastapprox `pow`, not
    // an exact cbrt (see src/noise/fastApprox.ts + docs/noise/random-penalty-NOTES.md);
    // exact Math.cbrt is off by ~7e-5 relative and would fail at 6 decimals.
    const d = 800;
    const meanSize = (iron.randomSpotSizeMin + iron.randomSpotSizeMax) / 2;
    const expected =
      fastCbrt(meanSize * regularSpotQuantityBaseAt(d, iron, one)) /
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

describe("starting-patch local functions (iron, default controls)", () => {
  // starting_amount = 20000 * 10 * (1 + 1) * 1 = 400000
  it("startingAmount", () => expect(startingAmount(iron, one)).toBeCloseTo(400000, 6));
  // starting_area_spot_quantity = 400000 / 0.5 / 1 = 800000
  it("startingAreaSpotQuantity", () =>
    expect(startingAreaSpotQuantity(iron, one)).toBeCloseTo(800000, 6));
  // starting_modulation = starting_resource_placement_radius(=150) > distance
  it("startingModulation", () => {
    expect(startingModulation(50)).toBe(1);
    expect(startingModulation(150)).toBe(0); // 150 > 150 is false
    expect(startingModulation(200)).toBe(0);
  });
  // density at d=50 = 400000 / (pi * 150^2) * 1
  it("startingDensityAt inside", () =>
    expect(startingDensityAt(50, iron, one)).toBeCloseTo(400000 / (Math.PI * 150 * 150), 6));
  it("startingDensityAt outside is 0", () => expect(startingDensityAt(200, iron, one)).toBe(0));
  // radius = (1.5/7) * cbrt(800000) ~= 0.214286 * 92.832 ~= 19.89 (fastCbrt ~ exact to ~1e-4)
  it("startingSpotRadius", () =>
    expect(startingSpotRadius(iron, one)).toBeCloseTo((1.5 / 7) * Math.cbrt(800000), 2));
  // favorability = lake_mask * starting_modulation * origin_excluder * 2 - min(1, distance/150).
  // At d=60, elev=11: clamp((11-1)/10,0,1)*(150>60)*(60>40)*2 - min(1,60/150) = 1*1*1*2 - 0.4 = 1.6
  it("startingFavorabilityBaseAt land near spawn", () =>
    expect(startingFavorabilityBaseAt(60, 11, iron, one)).toBeCloseTo(1.6, 6));
  // origin_excluder = distance > 40: at d=30 (< 40, crash-site exclusion) the lake_mask
  // term zeroes out, leaving -min(1, 30/150) = -0.2
  it("startingFavorabilityBaseAt inside origin excluder", () =>
    expect(startingFavorabilityBaseAt(30, 11, iron, one)).toBeCloseTo(-30 / 150, 6));
  // at d=200 (outside modulation): lake_mask * 0 * ... * 2 - min(1, 200/150) = -1
  it("startingFavorabilityBaseAt outside", () =>
    expect(startingFavorabilityBaseAt(200, 11, iron, one)).toBeCloseTo(-1, 6));
});
