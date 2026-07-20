import { describe, expect, it } from "vite-plus/test";
import fixture from "./fixtures/spot-selection.game.json";
import { selectSpots, type SelectedSpot } from "../src/noise/spotSelection";

// The probes fixed spot_radius_expression = 20 and read the cone peak at the
// apex: peak = 3q / (pi * (20*coneScale)^2), with q the (possibly hard-target
// shrunk) spot quantity.
function peakOf(s: SelectedSpot): number {
  const r = 20 * s.coneScale;
  return (3 * s.quantity) / (Math.PI * r * r);
}

type ExprSpec = { kind: string; value?: number; base?: number; scale?: number; offset?: number };

function decode(e: ExprSpec): (x: number, y: number) => number {
  switch (e.kind) {
    case "const":
      return () => e.value ?? 0;
    case "x":
      return (x) => x;
    case "negx":
      return (x) => -x;
    case "xminus":
      return (x) => x - (e.offset ?? 0);
    case "xplus":
      return (x) => (e.base ?? 0) + x;
    case "x2":
      return (x) => x * x * (e.scale ?? 1);
    case "stepx":
      return (x) => (x > 0 ? (e.value ?? 0) : 0);
    default:
      throw new Error(`unknown expression kind ${e.kind}`);
  }
}

describe("selectSpots", () => {
  for (const c of fixture.cases) {
    it(`matches the game for probe "${c.name}"`, () => {
      const spots = selectSpots(
        { seed0: c.seed0, seed1: c.seed1, regionX: c.regionX, regionY: c.regionY },
        {
          regionSize: c.regionSize,
          candidateSpotCount: c.count,
          spacing: c.spacing,
          skipSpan: c.skipSpan,
          skipOffset: c.skipOffset,
          hardRegionTargetQuantity: c.hard,
          density: decode(c.density),
          quantity: decode(c.quantity),
          favorability: decode(c.favorability),
        },
      );
      const got = spots
        .map((s) => [s.x, s.y, peakOf(s)] as const)
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      expect(got.map(([x, y]) => [x, y])).toEqual(c.spots.map(([x, y]) => [x, y]));
      for (let i = 0; i < got.length; i++) {
        // fixture peaks were read off the field with 3-decimal rounding
        expect(Math.abs(got[i][2] - c.spots[i][2])).toBeLessThan(0.005);
      }
    });
  }

  // The game skips a spot with non-positive quantity or radius - "not emitted, not
  // counted toward the target" (docs/noise/spot-noise-NOTES.md, "The effective
  // radius is min(maximum_spot_basement_radius, radius_expression) ... a spot with
  // non-positive quantity or radius is skipped"). Near spawn, regular resource
  // density fades to 0, so its spots get quantity 0; if we emit them they render as
  // a degenerate flat cone=0 disk across the whole cull radius (a "crescent" once
  // the blob term lifts part of it above 0.5).
  const params = {
    regionSize: 1024,
    candidateSpotCount: 21,
    spacing: 45.254833995939045,
    skipSpan: 1,
    skipOffset: 0,
    favorability: () => 1,
  };
  const key = { seed0: 123456, seed1: 100, regionX: 0, regionY: 0 };

  it("emits no spot whose quantity is non-positive (per-spot quantity)", () => {
    const out = selectSpots(key, {
      ...params,
      density: () => 1,
      // quantity 0 for x <= 0, positive otherwise
      quantity: (x) => (x > 0 ? 1000 : 0),
    });
    expect(out.length).toBeGreaterThan(0); // the x>0 spots survive
    expect(out.every((s) => s.quantity > 0)).toBe(true);
  });

  it("emits nothing when every spot's quantity is zero", () => {
    const out = selectSpots(key, { ...params, density: () => 1, quantity: () => 0 });
    expect(out).toEqual([]);
  });

  it("skips non-positive quantities from a quantityBatch too", () => {
    const out = selectSpots(key, {
      ...params,
      density: () => 1,
      quantity: () => 0, // unused
      quantityBatch: (spots) => spots.map((s) => (s.x > 0 ? 1000 : 0)),
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.quantity > 0)).toBe(true);
  });
});

describe("selectSpots favorabilityBatch", () => {
  const key = { seed0: 123456, seed1: 100, regionX: 1, regionY: 1 };
  const base = {
    density: () => 1, // small target
    quantity: () => 1e6,
    regionSize: 1024,
    candidateSpotCount: 6,
    spacing: 45.254833995939045,
    skipSpan: 1,
    skipOffset: 0,
    hardRegionTargetQuantity: true as const,
  };
  it("uses the batched favorability for the trim sort (overrides per-spot)", () => {
    // Per-spot favorability that would keep the FIRST-accepted spot (all equal ->
    // acceptance order); a batch that flips it (descending index) keeps a LATER spot.
    const perSpot = selectSpots(key, { ...base, favorability: () => 0 });
    const batched = selectSpots(key, {
      ...base,
      favorability: () => 0,
      favorabilityBatch: (spots) => spots.map((_, i) => i), // last accepted = highest fav
    });
    expect(batched.length).toBeGreaterThan(0);
    // The batched run keeps the highest-index (last-accepted) spot first; assert its
    // top-kept position differs from the per-spot run's top-kept position.
    expect({ x: batched[0].x, y: batched[0].y }).not.toEqual({ x: perSpot[0].x, y: perSpot[0].y });
  });
});
