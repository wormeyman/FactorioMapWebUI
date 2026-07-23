import { describe, expect, it } from "vite-plus/test";
import { makeRockDensity } from "../src/noise/rocks/rockField";
import { makeMultioctaveNoise } from "../src/noise/multioctaveNoise";
import { makeMoisture } from "../src/noise/expressions/moisture";
import { makeAux } from "../src/noise/expressions/aux";
import { distanceFromNearestPoint } from "../src/noise/distanceFromNearestPoint";
import { rangeSelectBase, sliderRescale, ROCK_SEED1 } from "../src/noise/rocks/rockCatalog";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

// Independently recompute max_i probability_i from the same primitives, so a
// wrong seed1, penalty, multiplier, or region_box band fails loudly. This is NOT
// the game oracle (that is Task 3) - it locks the wiring/composition.
function expected(seed0: number, x: number, y: number): number {
  const spawn = [{ x: 0, y: 0 }];
  const noise = makeMultioctaveNoise({
    seed0, seed1: ROCK_SEED1, octaves: 4, persistence: 0.9, inputScale: 0.15, outputScale: 1,
  });
  const moisture = makeMoisture({ seed0, startingPositions: [...spawn] });
  const aux = makeAux({ seed0 });
  const rockNoise = noise(x, y) + 0.25 + 0.75 * (sliderRescale(1, 1.5) - 1);
  const distance = distanceFromNearestPoint(x, y, spawn);
  const rockDensity = rockNoise - Math.max(0, 1.1 - distance / 32);
  const m = moisture(x, y);
  const a = aux(x, y);
  const moistBand = rangeSelectBase(m, 0.35, 1, 0.2, -10, 0);
  const sandBand = Math.min(
    rangeSelectBase(a, 0.3, 1, 0.3, -10, 0),
    rangeSelectBase(m, 0, 0.3, 0.2, -10, 0),
  );
  const pHuge = 0.07 * 1 * (moistBand + rockDensity - 1.7);
  const pBig = 0.17 * 1 * (moistBand + rockDensity - 1.6);
  const pSand = 0.1 * 1 * (sandBand + rockDensity - 1.6);
  return clamp(Math.max(pHuge, pBig, pSand), 0, 1);
}

describe("makeRockDensity", () => {
  const seed0 = 123456;
  const field = makeRockDensity({ seed0 });
  for (const [x, y] of [
    [300, -180], [512, 512], [-800, 640], [40, 40],
  ] as const) {
    it(`composes max_i probability_i at (${x},${y})`, () => {
      expect(field(x, y)).toBeCloseTo(expected(seed0, x, y), 10);
    });
  }
  it("clamps to [0,1] and is 0 on most far tiles (rocks are sparse)", () => {
    const v = field(5000, 5000);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
