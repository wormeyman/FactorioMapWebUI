import { describe, expect, it } from "vite-plus/test";
import { makeNauvisShared } from "../src/noise/expressions/nauvisShared";
import { makeMultioctaveNoise } from "../src/noise/multioctaveNoise";

const SEED0 = 123456;
const POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [37, -14],
  [-512, 256],
  [1000, 1000],
];

describe("makeNauvisShared", () => {
  it("computes nauvisSeg = 1.5 * segmentationMultiplier", () => {
    const nz1 = makeNauvisShared({ seed0: SEED0, segmentationMultiplier: 1 });
    expect(nz1.nauvisSeg).toBe(1.5);

    const nz2 = makeNauvisShared({ seed0: SEED0, segmentationMultiplier: 2 });
    expect(nz2.nauvisSeg).toBe(3);
  });

  it("hills matches the raw multioctave noise (seed1 900, inputScale nauvisSeg/90)", () => {
    const nz = makeNauvisShared({ seed0: SEED0, segmentationMultiplier: 1 });
    const rawHills = makeMultioctaveNoise({
      seed0: SEED0,
      seed1: 900,
      octaves: 4,
      persistence: 0.5,
      inputScale: nz.nauvisSeg / 90,
      outputScale: 1,
    });
    for (const [x, y] of POINTS) {
      expect(nz.hills(x, y)).toBe(Math.abs(rawHills(x, y)));
    }
  });

  it("bridgeBillows matches the raw multioctave noise (seed1 700, inputScale nauvisSeg/150)", () => {
    const nz = makeNauvisShared({ seed0: SEED0, segmentationMultiplier: 1 });
    const rawBridgeBillows = makeMultioctaveNoise({
      seed0: SEED0,
      seed1: 700,
      octaves: 4,
      persistence: 0.5,
      inputScale: nz.nauvisSeg / 150,
      outputScale: 1,
    });
    for (const [x, y] of POINTS) {
      expect(nz.bridgeBillows(x, y)).toBe(Math.abs(rawBridgeBillows(x, y)));
    }
  });

  it("forestPathBillows matches the raw multioctave noise (seed1 1800, inputScale nauvisSeg/100, no offsetX)", () => {
    const nz = makeNauvisShared({ seed0: SEED0, segmentationMultiplier: 1 });
    const rawForestPathBillows = makeMultioctaveNoise({
      seed0: SEED0,
      seed1: 1800,
      octaves: 4,
      persistence: 0.5,
      inputScale: nz.nauvisSeg / 100,
      outputScale: 1,
    });
    for (const [x, y] of POINTS) {
      expect(nz.forestPathBillows(x, y)).toBe(Math.abs(rawForestPathBillows(x, y)));
      expect(nz.forestPathBillows(x, y)).toBeGreaterThanOrEqual(0);
    }
  });

  it("cliffLevel is clamped to [0.15, 1.15]", () => {
    const nz = makeNauvisShared({ seed0: SEED0, segmentationMultiplier: 1 });
    for (const [x, y] of POINTS) {
      const v = nz.cliffLevel(x, y);
      expect(v).toBeGreaterThanOrEqual(0.15);
      expect(v).toBeLessThanOrEqual(1.15);
    }
  });

  it("plateaus is within [0, 1] and matches (hills - cliffLevel) * 10 clamped +0.5", () => {
    const nz = makeNauvisShared({ seed0: SEED0, segmentationMultiplier: 1 });
    for (const [x, y] of POINTS) {
      const v = nz.plateaus(x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const expected =
        0.5 + Math.min(0.5, Math.max(-0.5, (nz.hills(x, y) - nz.cliffLevel(x, y)) * 10));
      expect(v).toBe(expected);
    }
  });
});
