import { describe, expect, it } from "vite-plus/test";
import fixture from "../fixtures/oracle-elevation-lakes.seed123456.json";
import { startingLakePositions } from "../../src/noise/startingLakes";
import { distanceFromNearestPoint } from "../../src/noise/distanceFromNearestPoint";

describe("startingLakePositions (RE of MapGenSettings::getStartingLakePositions)", () => {
  it("computes the game's real starting lake for seed 123456", () => {
    // Trilaterated exactly from the fixture's 9 near-spawn startingLakeDistance values.
    expect(startingLakePositions(123456, [{ x: 0, y: 0 }])).toEqual([{ x: 45, y: -59 }]);
  });

  it("reproduces every near-spawn startingLakeDistance in the fixture", () => {
    const lakes = startingLakePositions(fixture.seed0, [{ x: 0, y: 0 }]);
    let worst = 0;
    for (let i = 0; i < fixture.positions.length; i++) {
      const p = fixture.positions[i];
      const d = distanceFromNearestPoint(p.x, p.y, lakes, 1024);
      worst = Math.max(worst, Math.abs(d - fixture.startingLakeDistance[i]));
    }
    // The fixture stores distances as f32 (game dump), so f64-vs-f32 rounding
    // (~1 f32 ulp, ~1e-5 at these ~90-tile magnitudes) is the floor here; the
    // lake POSITION itself is exact (see the (45,-59) case above). A 1-tile miss
    // would show O(1) error, four orders of magnitude above this bound.
    expect(worst).toBeLessThan(2e-5);
  });

  it("places each lake at radius 75 from its spawn (pre-truncation invariant)", () => {
    const [lake] = startingLakePositions(999, [{ x: 0, y: 0 }]);
    expect(Math.hypot(lake.x, lake.y)).toBeGreaterThan(73);
    expect(Math.hypot(lake.x, lake.y)).toBeLessThanOrEqual(75);
  });

  it("returns one lake per starting position, in order", () => {
    const lakes = startingLakePositions(123456, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ]);
    expect(lakes).toHaveLength(2);
    // second lake is near its own spawn (within radius 75)
    expect(Math.hypot(lakes[1].x - 1000, lakes[1].y)).toBeLessThanOrEqual(75);
  });

  it("returns empty for empty starting positions", () => {
    expect(startingLakePositions(123456, [])).toEqual([]);
  });
});
