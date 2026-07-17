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
});
