import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/basis-noise.seed123456.json";
import { basisNoise, type BasisNoiseTables } from "../src/noise/basisNoise";

// Ground truth captured from Factorio 2.1.11 via calculate_tile_properties.
// See docs/noise/basis-noise-NOTES.md for how the tables were recovered.
const tables: BasisNoiseTables = {
  sigma: fixture.sigma,
  a: fixture.a,
  b: fixture.b,
};

describe("basisNoise", () => {
  it("reproduces the game's own values at 512 independent points", () => {
    let worst = 0;
    for (const p of fixture.points) {
      const got = basisNoise(p.x * fixture.inputScale, p.y * fixture.inputScale, tables);
      worst = Math.max(worst, Math.abs(got - p.v));
    }
    // The game's own noise stack disagrees with itself by ~2e-6 (fastapprox pow),
    // so this bound is tighter than Factorio's internal self-consistency.
    expect(worst).toBeLessThan(1e-5);
  });

  it("returns exactly 0 on integer lattice points, as the game documents", () => {
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        expect(basisNoise(i, j, tables)).toBe(0);
      }
    }
  });

  it("is periodic with period 256 on both axes", () => {
    for (const [x, y] of [
      [0.5, 0.25],
      [11.125, 7.75],
      [-3.5, 2.125],
    ]) {
      expect(basisNoise(x + 256, y, tables)).toBeCloseTo(basisNoise(x, y, tables), 12);
      expect(basisNoise(x, y + 256, tables)).toBeCloseTo(basisNoise(x, y, tables), 12);
    }
  });

  it("stays within the measured output range", () => {
    // Hanodest's widely-quoted [-sqrt(3), sqrt(3)] is ~2% low; the real bound is
    // near 1.77. Guard the measured envelope, not the folklore one.
    let peak = 0;
    for (let i = 0; i < 4000; i++) {
      const x = (i * 7.13) % 251.7;
      const y = (i * 3.37) % 197.3;
      peak = Math.max(peak, Math.abs(basisNoise(x, y, tables)));
    }
    expect(peak).toBeGreaterThan(Math.sqrt(3));
    expect(peak).toBeLessThan(1.78);
  });
});
