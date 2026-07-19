import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-elevation-lakes.seed123456.json";
import { makeElevationLakes } from "../src/noise/expressions/elevationLakes";

// Task 0 confirmed: starting_positions = origin spawn (distance == hypot), so the
// EvalCtx defaults are faithful. starting_lake_positions is non-empty near spawn,
// so we parity-test only where the game's own starting_lake_distance saturated at
// 1024 (the empty-lake far-from-spawn ctx is exact there).
const SATURATED = (i: number) => fixture.startingLakeDistance[i] >= 1024;

describe("elevationLakes reproduces the game's elevation_lakes tree (far from spawn)", () => {
  const evalAt = makeElevationLakes({ seed0: fixture.seed0 });

  it("has parity-testable points (guards against a fixture regen dropping them)", () => {
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

  it("matches the numeric elevation to the f32 coordinate floor", () => {
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
    // offset_x = 10000 puts every point in the f32 regime; the game's f32 coordinate
    // pipeline diverges from our f64 (see variablePersistence spec's far-field bound).
    // Calibrated just above the observed worst (~7.37e-3).
    expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
  });

  it("now matches near-spawn elevation too (computed starting lakes)", () => {
    // evalAt uses the computed starting_lake_positions default, so the near-spawn
    // band the M1 test could not assert (starting_lake_distance < 1024) is now
    // faithful. This is the payoff of porting getStartingLakePositions.
    let worst = 0;
    let worstLabel = "";
    let checked = 0;
    for (let i = 0; i < fixture.positions.length; i++) {
      if (SATURATED(i)) continue; // the previously-unassertable near-spawn band
      const p = fixture.positions[i];
      const err = Math.abs(evalAt(p.x, p.y) - fixture.elevation[i]);
      checked++;
      if (err > worst) {
        worst = err;
        worstLabel = `@(${p.x},${p.y})`;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(9);
    // Same 8e-3 f32 floor as the far field (offset_x=10000 shifts the varPers
    // sampling into the f32 regime everywhere). The point is that terms 2-4, which
    // consume starting_lake_distance, now use the CORRECT near-spawn lakes - so
    // near spawn stays within that floor instead of diverging as it did with [].
    expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
  });
});
