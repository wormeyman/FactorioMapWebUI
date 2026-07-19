import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-elevation-nauvis.seed123456.json";
import { makeElevationNauvis } from "../src/noise/expressions/elevationNauvis";

// Parity-test only where the game's own starting_lake_distance saturated at 1024;
// near spawn is asserted separately (computed starting lakes make it faithful too).
const SATURATED = (i: number) => fixture.startingLakeDistance[i] >= 1024;

describe("elevationNauvis reproduces the game's elevation_nauvis tree", () => {
  const evalAt = makeElevationNauvis({ seed0: fixture.seed0 });

  it("has parity-testable far points (guards against a fixture regen dropping them)", () => {
    expect(fixture.positions.filter((_p, i) => SATURATED(i)).length).toBeGreaterThanOrEqual(12);
  });

  it("matches the water mask (elevation < 0) away from the coastline", () => {
    for (let i = 0; i < fixture.positions.length; i++) {
      if (!SATURATED(i)) continue;
      const exp = fixture.elevation[i];
      if (Math.abs(exp) < 1e-3) continue; // coastline: sign is ambiguous within the floor
      const p = fixture.positions[i];
      expect(evalAt(p.x, p.y) < 0).toBe(exp < 0);
    }
  });

  it("matches the numeric elevation to the f32 coordinate floor (far field)", () => {
    let worst = 0;
    let worstLabel = "";
    for (let i = 0; i < fixture.positions.length; i++) {
      if (!SATURATED(i)) continue;
      const p = fixture.positions[i];
      const err = Math.abs(evalAt(p.x, p.y) - fixture.elevation[i]);
      if (err > worst) {
        worst = err;
        worstLabel = `@(${p.x},${p.y})`;
      }
    }
    // offset_x = 10000/nauvisSeg puts nauvis_detail's sampling in the f32 regime, so
    // the game's f32 coordinate pipeline diverges from our f64; nauvis amplifies that
    // floor by ~20x (elevation_magnitude). Bound calibrated to just above the observed
    // deep-field worst (see plan Task 3 Step 4). Start at 8e-3, then raise to fit.
    expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
  });

  it("matches near-spawn elevation too (computed starting lakes)", () => {
    let worst = 0;
    let worstLabel = "";
    let checked = 0;
    for (let i = 0; i < fixture.positions.length; i++) {
      if (SATURATED(i)) continue;
      const p = fixture.positions[i];
      const err = Math.abs(evalAt(p.x, p.y) - fixture.elevation[i]);
      checked++;
      if (err > worst) {
        worst = err;
        worstLabel = `@(${p.x},${p.y})`;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6);
    expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
  });
});
