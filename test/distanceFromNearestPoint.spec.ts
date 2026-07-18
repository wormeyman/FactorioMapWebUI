import { describe, expect, it } from "vite-plus/test";

import { distanceFromNearestPoint, type Point } from "../src/noise/distanceFromNearestPoint";

// This primitive is plain geometry read off the disassembly
// (DistanceFromNearestPoint::run @0x101759568); the noise DSL rejects a literal
// `points` list, so it is verified against the closed-form distance rather than the
// oracle (it validates end-to-end through the elevation tree later).
describe("distanceFromNearestPoint reproduces the game's geometry", () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 0, y: 40 },
    { x: -50, y: 30 },
  ];

  it("returns the Euclidean distance to the nearest point", () => {
    // Right on a point.
    expect(distanceFromNearestPoint(0, 0, points, 1024)).toBe(0);
    // Between origin and (40,0): closest is origin at distance 10.
    expect(distanceFromNearestPoint(10, 0, points, 1024)).toBeCloseTo(10, 10);
    // (36,0): closest is (40,0) at distance 4.
    expect(distanceFromNearestPoint(36, 0, points, 1024)).toBeCloseTo(4, 10);
    // A 3-4-5 triangle from (0,40): (3,44) -> distance 5.
    expect(distanceFromNearestPoint(3, 44, points, 1024)).toBeCloseTo(5, 10);
  });

  it("caps the result at maximumDistance", () => {
    // Far from every point; capped.
    expect(distanceFromNearestPoint(100000, 100000, points, 1024)).toBe(1024);
    // Exactly at the cap distance stays capped (bestSq == maxSq -> maximumDistance).
    expect(distanceFromNearestPoint(1024, 0, [{ x: 0, y: 0 }], 1024)).toBe(1024);
    // Just inside the cap returns the true distance.
    expect(distanceFromNearestPoint(1000, 0, [{ x: 0, y: 0 }], 1024)).toBeCloseTo(1000, 10);
  });

  it("with no points returns maximumDistance (Infinity by default)", () => {
    expect(distanceFromNearestPoint(5, 5, [], 1024)).toBe(1024);
    expect(distanceFromNearestPoint(5, 5, [])).toBe(Infinity);
  });

  it("quantises points to 1/256 fixed-point (a no-op for integer positions)", () => {
    // A tiny sub-1/256 offset snaps to the nearest grid point; 0.001 < 0.5/256 so it
    // rounds to 0 -> distance 0 (avoids the exact-half tie, whose rounding is unknown).
    expect(distanceFromNearestPoint(0, 0, [{ x: 0.001, y: 0 }])).toBe(0);
    // An exact 1/256 multiple is preserved.
    expect(distanceFromNearestPoint(0, 0, [{ x: 1 / 256, y: 0 }])).toBeCloseTo(1 / 256, 12);
    // Integer positions are untouched.
    expect(distanceFromNearestPoint(0, 0, [{ x: 7, y: 0 }])).toBeCloseTo(7, 12);
  });
});
