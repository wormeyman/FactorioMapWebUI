import { describe, expect, it } from "vite-plus/test";
import {
  makeNauvisShared,
  NAUVIS_OFFSET_X_SEED1,
  NAUVIS_OFFSET_Y_SEED1,
} from "../src/noise/expressions/nauvisShared";
import { makeMultioctaveNoise } from "../src/noise/multioctaveNoise";
import { basisNoise, basisNoiseTablesFromSeed } from "../src/noise/basisNoise";
import offFixture from "./fixtures/oracle-cliff-offset-raw.seed123456.json";

/** Combined abs/rel tolerance (never loosen): max(1.0, 1e-2 * |game|). */
const ok = (p: number, g: number): boolean => Math.abs(p - g) < Math.max(1.0, 1e-2 * Math.abs(g));
/** Worst absolute error across a predicate-checked field, for reporting. */
const worstAbs = (predVals: number[], gameVals: number[]): number =>
  predVals.reduce((m, p, i) => Math.max(m, Math.abs(p - gameVals[i])), 0);

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

describe("nauvis cliff offset chain vs oracle", () => {
  it("the string-seed constants resolve to crc32(name)", () => {
    expect(NAUVIS_OFFSET_X_SEED1).toBe(593691028);
    expect(NAUVIS_OFFSET_Y_SEED1).toBe(1415852290);
  });

  for (const c of offFixture.cases) {
    it(`raw_x/raw_y string-seed reproduce seed=${c.seed}`, () => {
      const is = 1.5 / 500; // nauvisSeg / 500, default seg 1
      const tx = basisNoiseTablesFromSeed(c.seed, NAUVIS_OFFSET_X_SEED1);
      const ty = basisNoiseTablesFromSeed(c.seed, NAUVIS_OFFSET_Y_SEED1);
      const predX = offFixture.positions.map((p) => basisNoise(p.x * is, p.y * is, tx));
      const predY = offFixture.positions.map((p) => basisNoise(p.x * is, p.y * is, ty));
      for (let i = 0; i < offFixture.positions.length; i++) {
        expect(ok(predX[i], c.rawX[i])).toBe(true);
        expect(ok(predY[i], c.rawY[i])).toBe(true);
      }
      console.log(
        `  raw_x/raw_y seed=${c.seed}: worstAbs rawX=${worstAbs(predX, c.rawX).toExponential(2)}, rawY=${worstAbs(predY, c.rawY).toExponential(2)}`,
      );
    });

    it(`hillsOffset seed=${c.seed}`, () => {
      const nz = makeNauvisShared({ seed0: c.seed });
      const pred = offFixture.positions.map((p) => nz.hillsOffset(p.x, p.y));
      for (let i = 0; i < offFixture.positions.length; i++) {
        expect(ok(pred[i], c.hillsOffset[i])).toBe(true);
      }
      console.log(
        `  hillsOffset seed=${c.seed}: worstAbs=${worstAbs(pred, c.hillsOffset).toExponential(2)}`,
      );
    });

    it(`cliffRingbreak seed=${c.seed}`, () => {
      const nz = makeNauvisShared({ seed0: c.seed });
      const pred = offFixture.positions.map((p) => nz.cliffRingbreak(p.x, p.y));
      for (let i = 0; i < offFixture.positions.length; i++) {
        expect(ok(pred[i], c.ringbreak[i])).toBe(true);
      }
      console.log(
        `  cliffRingbreak seed=${c.seed}: worstAbs=${worstAbs(pred, c.ringbreak).toExponential(2)}`,
      );
    });
  }
});
