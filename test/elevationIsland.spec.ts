import { describe, expect, it } from "vite-plus/test";
import { makeElevationIsland, elevationIsland } from "../src/noise/expressions/elevationIsland";
import { makeElevationLakes } from "../src/noise/expressions/elevationLakes";

const GRID: Array<[number, number]> = [
  [0.5, 0.25],
  [2200.5, 0.25],
  [-1600.5, 1200.25],
  [12345.75, 6789.125],
];

describe("makeElevationIsland delegates to lakes with bias=-1000 and seg/4", () => {
  it("equals makeElevationLakes with bias -1000 and segmentation/4 (default seg 1)", () => {
    const island = makeElevationIsland({ seed0: 123456 });
    const lakes = makeElevationLakes({ seed0: 123456, bias: -1000, segmentationMultiplier: 0.25 });
    for (const [x, y] of GRID) expect(island(x, y)).toBe(lakes(x, y));
  });

  it("divides an explicit segmentationMultiplier by 4", () => {
    const island = makeElevationIsland({ seed0: 123456, segmentationMultiplier: 2 });
    const lakes = makeElevationLakes({ seed0: 123456, bias: -1000, segmentationMultiplier: 0.5 });
    for (const [x, y] of GRID) expect(island(x, y)).toBe(lakes(x, y));
  });

  it("passes waterLevel and startingPositions through", () => {
    const opts = { seed0: 123456, waterLevel: 15, startingPositions: [{ x: 300, y: -400 }] };
    const island = makeElevationIsland(opts);
    const lakes = makeElevationLakes({ ...opts, bias: -1000, segmentationMultiplier: 0.25 });
    for (const [x, y] of GRID) expect(island(x, y)).toBe(lakes(x, y));
  });

  it("elevationIsland(ctx) matches makeElevationIsland(...)(x, y)", () => {
    const at = makeElevationIsland({ seed0: 123456 });
    expect(elevationIsland({ seed0: 123456, x: 2200.5, y: 0.25 })).toBe(at(2200.5, 0.25));
  });
});
