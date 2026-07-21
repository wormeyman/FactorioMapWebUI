import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/oracle-elevation-nauvis.seed123456.json";
import noCliffFixture from "./fixtures/oracle-elevation-nauvis-no-cliff.seed123456.json";
import { makeElevationNauvis } from "../src/noise/expressions/elevationNauvis";

// Parity-test only where the game's own starting_lake_distance saturated at 1024;
// near spawn is asserted separately (computed starting lakes make it faithful too).
// (The fixture also carries a `distance` array as captured oracle context; the spec
// keys purely off startingLakeDistance and does not assert `distance` directly.)
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
    // floor by ~20x (elevation_magnitude). This is the pure f32-floor divergence, NOT
    // a knob to loosen: the observed worst is ~4.08e-3 (deep field), and 8e-3 is a
    // fixed bound with ~2x headroom for platform f32 / fixture-regen jitter. A failure
    // here is a real finding to debug, not a bound to raise.
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
    // Near spawn the coordinates are small, so the f32 floor is tiny (observed worst
    // ~2.87e-6) - far below the far-field 8e-3. This band is the ONE seam this tree
    // adds beyond lakes: it exercises the computed starting_lake_positions
    // (startingLakes.ts). A tight 1e-4 bound (still ~35x headroom) makes this assertion
    // actually guard that path - a drift in the computed lake positions would trip it.
    expect(worst, `worst ${worstLabel}`).toBeLessThan(1e-4);
  });
});

// elevation_nauvis_no_cliff = elevation_nauvis_function(added_cliff_elevation = 0) - the
// cliffiness field's dependency (Task 6 / cliff_elevation_nauvis). Same standard grid and
// same combined abs tolerance bands as the elevation_nauvis block above (far-field 8e-3 is
// the f32-coordinate floor amplified by elevation_magnitude=20; near-field 1e-4 guards the
// computed starting_lake_positions path). Positions are identical between the two fixtures
// (same standard grid), which lets the structural check below index them 1:1.
describe("elevationNauvis(withCliffElevation:false) reproduces elevation_nauvis_no_cliff", () => {
  for (const c of noCliffFixture.cases) {
    const evalAt = makeElevationNauvis({ seed0: c.seed, withCliffElevation: false });
    const noCliffSaturated = (i: number) => c.startingLakeDistance[i] >= 1024;

    it(`matches the numeric elevation to the f32 coordinate floor (far field, seed=${c.seed})`, () => {
      let worst = 0;
      let worstLabel = "";
      for (let i = 0; i < noCliffFixture.positions.length; i++) {
        if (!noCliffSaturated(i)) continue;
        const p = noCliffFixture.positions[i];
        const err = Math.abs(evalAt(p.x, p.y) - c.elevation[i]);
        if (err > worst) {
          worst = err;
          worstLabel = `@(${p.x},${p.y})`;
        }
      }
      expect(worst, `worst ${worstLabel}`).toBeLessThan(8e-3);
    });

    it(`matches near-spawn elevation too (computed starting lakes, seed=${c.seed})`, () => {
      let worst = 0;
      let worstLabel = "";
      let checked = 0;
      for (let i = 0; i < noCliffFixture.positions.length; i++) {
        if (noCliffSaturated(i)) continue;
        const p = noCliffFixture.positions[i];
        const err = Math.abs(evalAt(p.x, p.y) - c.elevation[i]);
        checked++;
        if (err > worst) {
          worst = err;
          worstLabel = `@(${p.x},${p.y})`;
        }
      }
      expect(checked).toBeGreaterThanOrEqual(6);
      expect(worst, `worst ${worstLabel}`).toBeLessThan(1e-4);
    });
  }

  it("differs from elevation_nauvis (with-cliff) where added_cliff_elevation != 0, and matches where the outer min() masks it", () => {
    // fixture (seed 123456, WITH cliff term) and noCliffFixture (seed 123456, no-cliff
    // term) share the exact same standard grid, so positions[i] line up 1:1. The final
    // elevation is min(wlc_elevation, starting_lake); wherever starting_lake wins,
    // added_cliff_elevation (which only feeds wlc_elevation) has no effect and the two
    // trees coincide even though the term itself is nonzero - hence "NOT assumed" that
    // no-cliff <= with-cliff, and this checks BOTH outcomes actually occur.
    expect(fixture.positions).toEqual(noCliffFixture.positions);
    const noCliff123456 = noCliffFixture.cases.find((c) => c.seed === fixture.seed0);
    expect(noCliff123456).toBeDefined();
    let numDiffer = 0;
    let numEqual = 0;
    for (let i = 0; i < fixture.positions.length; i++) {
      const withCliff = fixture.elevation[i];
      const noCliff = noCliff123456!.elevation[i];
      if (Math.abs(withCliff - noCliff) < 1e-6) {
        numEqual++;
      } else {
        numDiffer++;
      }
    }
    // Observed on the current fixture: 17 differ, 9 equal - both outcomes are real, not
    // an artifact of a too-small grid.
    expect(numDiffer).toBeGreaterThan(0);
    expect(numEqual).toBeGreaterThan(0);
  });
});
